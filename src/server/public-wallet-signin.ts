import { randomBytes } from 'node:crypto';
import { utils } from 'ethers';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_ID, signInMessage, type WalletSignInChallenge } from '../lib/wallet-signin-message';
import { HOODRICH_CHAIN_ID } from '../lib/pro-access';
import { account, authClient, database, takeQuota } from './public-services';
import { appendCookie, digest, fail, origin, sessionCookie, sessionToken } from './public-security';
export function walletSignInEnabled() { return process.env.WALLET_SIGNIN_ENABLED === 'true'; }
export function bindingCookieName() { return process.env.NODE_ENV === 'production' ? '__Host-hood-auth-binding' : 'hood-auth-binding'; }
export function readAuthBinding(req: NextApiRequest) {
 const name=bindingCookieName();
 const matches=(req.headers.cookie || '').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'='));
 if (!matches.length) return null;
 if (matches.length!==1 || !/^[0-9a-f]{64}$/.test(matches[0].slice(name.length+1))) fail(400,'AUTH_BINDING','Restart account sign-in from this website.');
 return digest(matches[0].slice(name.length+1));
}
export function prepareAuthBinding(req:NextApiRequest,res:NextApiResponse) {
 if (!readAuthBinding(req)) appendCookie(res,`${bindingCookieName()}=${sessionToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${process.env.NODE_ENV==='production'?'; Secure':''}`);
}
export function strictAuthBody(body:Record<string,unknown>,fields:string[]) {
 if(Object.keys(body).some(key=>!['action',...fields].includes(key)))fail(400,'AUTH_INPUT','Unexpected sign-in input.');
}
function requestId(value:unknown):string {
 if(typeof value!=='string'||!AUTH_ID.test(value))fail(400,'AUTH_INPUT','Restart account sign-in.'); return value;
}
function binding(req:NextApiRequest):string {
 const value=readAuthBinding(req); if(!value)fail(409,'AUTH_BINDING','Prepare account sign-in first.');return value;
}
async function operation(db:SupabaseClient,action:string,id:string|null,bind:string|null,payload:Record<string,unknown>={}) {
 const {data,error}=await db.rpc('hood_auth_attempt',{p_action:action,p_id:id,p_binding:bind,p_payload:payload});
 if(error)fail(503,'AUTH_UNAVAILABLE','Account sign-in is unavailable. Retry cancellation before starting again.');
 return data;
}
export async function cancelAuthAttempt(id:unknown) {
 const key=requestId(id);
 await takeQuota('auth-cancel-global',10000,3600);
 const data=await operation(database(),'cancel',key,null);
 if(data?.canceled!==true)fail(503,'AUTH_UNAVAILABLE','Cancellation is not confirmed. Retry cancellation.');
}
export async function logoutAuthAttempts(req:NextApiRequest,sessionHash:string|null) {
 const data=await operation(database(),'logout',null,readAuthBinding(req),{sessionHash});
 if(data?.canceled!==true)fail(503,'LOGOUT_UNAVAILABLE','Unable to sign out. Please retry.');
}
export async function beginAuthAttempt(req:NextApiRequest,body:Record<string,unknown>,method:'email'|'wallet',details:Record<string,unknown>={}) {
 const id=requestId(body.requestId),bind=binding(req);
 if(await account(req,false))fail(409,'ALREADY_SIGNED_IN','Sign out before signing in to another account.');
 const started=body.requestStartedAt;
 if(typeof started!=='string'||!Number.isFinite(Date.parse(started))||new Date(started).toISOString()!==started||Date.parse(started)<Date.now()-300000||Date.parse(started)>Date.now()+30000)fail(400,'AUTH_INPUT','Sign-in request expired. Start again.');
 await takeQuota('auth-attempt-global',1000,3600);
 const payload={method,requestStartedAt:started,expiresAt:new Date(Date.now()+300000).toISOString(),...details};
 const data=await operation(database(),'begin',id,bind,payload);
 if(data?.started!==true)fail(409,'AUTH_STALE','This sign-in was canceled or superseded. Start again.');
 return {id,bind};
}
export async function finishAuthAttempt(req:NextApiRequest,res:NextApiResponse,id:unknown,userId:string) {
 const key=requestId(id),token=sessionToken();
 const data=await operation(database(),'finish',key,binding(req),{sessionHash:digest(token),userId});
 if(data?.signedIn!==true)fail(409,'AUTH_STALE','This sign-in expired or was canceled. Start again.');
 sessionCookie(res,token);
}
export async function walletChallenge(req:NextApiRequest,body:Record<string,unknown>):Promise<WalletSignInChallenge> {
 strictAuthBody(body,['requestId','requestStartedAt','address']);
 if(!walletSignInEnabled())fail(503,'WALLET_SIGNIN_UNAVAILABLE','Wallet sign-in is not available yet.');
 if(typeof body.address!=='string'||body.address.length!==42)fail(400,'ADDRESS','Select a valid Ethereum wallet.');
 let address:string;
 try { address=utils.getAddress(String(body.address)); } catch { return fail(400,'ADDRESS','Select a valid Ethereum wallet.'); }
 if(/^0x0{40}$/.test(address))fail(400,'ADDRESS','Select a valid Ethereum wallet.');
 await takeQuota('wallet-auth:'+digest(address),20,900);
 const issued=Date.now();
 const input={challengeId:requestId(body.requestId),address,nonce:randomBytes(16).toString('hex'),issuedAt:new Date(issued).toISOString(),notBefore:new Date(issued-30000).toISOString(),expiresAt:new Date(issued+300000).toISOString()};
 const message=signInMessage(origin(),input);
 await beginAuthAttempt(req,body,'wallet',{...input,message});
 return {...input,message};
}
/** Native tokens remain server-side. Only a verified native web3 identity may receive an app session. */
export function nativeWalletUser(data:unknown,address:string):string {
 const result=data as {user?:{id?:unknown;identities?:unknown[]};session?:{user?:{id?:unknown}}};
 const user=result?.user,uid=user?.id;
 if(typeof uid!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)||result?.session?.user?.id!==uid||!Array.isArray(user?.identities))fail(503,'AUTH_IDENTITY','Wallet identity could not be verified.');
 const identities=user.identities.filter(raw=>{
  const identity=raw as {provider?:unknown;user_id?:unknown;identity_data?:Record<string,unknown>};
  const fields=identity?.identity_data;
  return identity?.provider==='web3'&&identity.user_id===uid&&fields?.address===address&&fields.chain==='ethereum'&&fields.network===HOODRICH_CHAIN_ID&&fields.domain===new URL(origin()).host;
 });
 if(identities.length!==1)fail(503,'AUTH_IDENTITY','Wallet identity could not be verified.');
 return uid;
}
export async function verifyWalletSignIn(req:NextApiRequest,res:NextApiResponse,body:Record<string,unknown>) {
 strictAuthBody(body,['challengeId','signature']);
 if(!walletSignInEnabled())fail(503,'WALLET_SIGNIN_UNAVAILABLE','Wallet sign-in is not available yet.');
 const id=requestId(body.challengeId),bind=binding(req);
 if(typeof body.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(body.signature))fail(400,'SIGNATURE','Unsupported wallet signature.');
 await takeQuota('wallet-verify-global',1000,3600);
 const details=await operation(database(),'claim',id,bind) as WalletSignInChallenge|null;
 if(!details)fail(409,'AUTH_STALE','This sign-in expired, was canceled or was already used.');
 try {
  if(details.challengeId!==id||details.message!==signInMessage(origin(),details)||utils.verifyMessage(details.message,body.signature)!==details.address)fail(401,'SIGNATURE','Wallet signature does not match this sign-in.');
 } catch { fail(401,'SIGNATURE','Wallet signature does not match this sign-in.'); }
 // One provider call per claim; uncertain outcomes are never automatically replayed.
 const {data,error}=await authClient().auth.signInWithWeb3({chain:'ethereum',message:details.message,signature:body.signature as `0x${string}`});
 if(error)fail(401,'WALLET_AUTH','Wallet sign-in failed. Cancel this attempt and start again.');
 await finishAuthAttempt(req,res,id,nativeWalletUser(data,details.address));
}
