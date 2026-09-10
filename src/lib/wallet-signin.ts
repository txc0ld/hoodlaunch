import { utils } from 'ethers';
import type { HolderWallet } from './holder-wallet';
import { HOODRICH_CHAIN_ID } from './pro-access';
import { AUTH_ID, signInMessage, type WalletSignInChallenge } from './wallet-signin-message';
export type SignInRequest = (action:string,data?:Record<string,string>,options?:{keepalive?:boolean})=>Promise<unknown>;
const PREFIX='hoodlabs:pending-signin:';
export const AUTH_INTENT_EVENT='hoodlabs-auth-intent';
const storageError=()=>new Error('Account sign-in needs local browser storage to track cancellation. Allow site storage and retry.');
/** Only random revocation handles are stored. No message, signature, key or Auth token. */
export function pendingAuthIds():string[] {
 if(typeof window==='undefined')return [];
 try {
  const ids:string[]=[];
  for(let i=0;i<window.localStorage.length;i++) {
   const key=window.localStorage.key(i);if(!key?.startsWith(PREFIX))continue;
   const id=key.slice(PREFIX.length);
   if(!AUTH_ID.test(id)||window.localStorage.getItem(key)!=='pending'||ids.length>=50)throw storageError();
   ids.push(id);
  }
  return ids;
 } catch { throw storageError(); }
}
function intentChanged(){window.dispatchEvent(new Event(AUTH_INTENT_EVENT));}
export function startClientAuth(){
 if(pendingAuthIds().length)throw new Error('Retry cancellation of the previous sign-in first.');
 const requestId=crypto.randomUUID();
 try { window.localStorage.setItem(PREFIX+requestId,'pending');if(window.localStorage.getItem(PREFIX+requestId)!=='pending')throw storageError(); }
 catch {throw storageError();}
 intentChanged();
 return {requestId,requestStartedAt:new Date().toISOString()};
}
export function completeClientAuth(id:string){
 if(!AUTH_ID.test(id))throw new Error('Invalid sign-in attempt.');
 try {window.localStorage.removeItem(PREFIX+id);if(window.localStorage.getItem(PREFIX+id)!==null)throw storageError();}catch{throw storageError();}
 intentChanged();
}
export function assertClientAuthCurrent(id:string){
 const ids=pendingAuthIds();
 if(ids.length!==1||ids[0]!==id)throw new Error('Account sign-in changed or was canceled. Start again.');
}
export async function cancelClientAuth(request:SignInRequest,id:string,keepalive=false){
 const response=await request('auth-cancel',{challengeId:id},{keepalive}) as {canceled?:unknown};
 if(response?.canceled!==true)throw new Error('Cancellation is not confirmed. Retry cancellation.');
 completeClientAuth(id);
}
export async function cancelPendingAuth(request:SignInRequest,keepalive=false){
 for(const id of pendingAuthIds())await cancelClientAuth(request,id,keepalive);
 if(pendingAuthIds().length)throw new Error('Another sign-in is pending. Retry cancellation.');
}
export async function signInWithWallet(wallet:HolderWallet,appOrigin:string,request:SignInRequest,current:()=>void,onIntent:(id:string)=>void){
 let changed=false,attempt:ReturnType<typeof startClientAuth>|undefined;
 const invalidate=()=>{changed=true;}; const events=['accountsChanged','chainChanged','disconnect'];
 const guard=()=>{current();if(changed)throw new Error('Wallet changed during sign-in. Start again.');if(attempt)assertClientAuthCurrent(attempt.requestId);};
 try {
  for(const event of events)wallet.on?.(event,invalidate);
  guard();const accounts=await wallet.request({method:'eth_requestAccounts'});guard();
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string')throw new Error('Connect a wallet first.');
  const address=utils.getAddress(accounts[0]);
  const sameWallet=async()=>{
   guard();const active=await wallet.request({method:'eth_accounts'});guard();
   const chain=await wallet.request({method:'eth_chainId'});guard();
   if(!Array.isArray(active)||typeof active[0]!=='string'||utils.getAddress(active[0])!==address)throw new Error('Your wallet account changed. Start again.');
   if(Number(chain)!==HOODRICH_CHAIN_ID)throw new Error('Switch to Robinhood Chain (4663), then sign in.');
  };
  await sameWallet();
  attempt=startClientAuth();onIntent(attempt.requestId);
  const prepared=await request('auth-prepare') as {prepared?:unknown};guard();
  if(prepared?.prepared!==true)throw new Error('Unable to prepare account sign-in.');
  const challenge=await request('wallet-signin-challenge',{...attempt,address}) as WalletSignInChallenge;guard();
  if(!challenge||challenge.challengeId!==attempt.requestId||challenge.address!==address||challenge.message!==signInMessage(appOrigin,challenge)||Date.parse(challenge.expiresAt)<=Date.now()||Date.parse(challenge.issuedAt)>Date.now()+30000)throw new Error('Sign-in details do not match this site.');
  await sameWallet();
  const signature=await wallet.request({method:'personal_sign',params:[utils.hexlify(utils.toUtf8Bytes(challenge.message)),address]});guard();
  if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new Error('Unsupported wallet signature.');
  await sameWallet();
  const result=await request('wallet-signin-verify',{challengeId:attempt.requestId,signature}) as {signedIn?:unknown};guard();
  await sameWallet();
  if(result?.signedIn!==true)throw new Error('Account sign-in was not confirmed.');
  completeClientAuth(attempt.requestId);
 } catch(error) {
  if(attempt)try {await cancelClientAuth(request,attempt.requestId);}catch{throw new Error('Sign-in result is unknown. Retry cancellation before using account tools.');}
  throw error;
 } finally {for(const event of events)wallet.removeListener?.(event,invalidate);}
}
