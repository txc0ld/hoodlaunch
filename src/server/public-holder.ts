import { randomBytes, randomUUID } from 'node:crypto';
import { BigNumber, Contract, providers, utils } from 'ethers';
import { EMPTY_HOLDER_ACCESS, HOODRICH_CHAIN_ID, HOODRICH_DECIMALS, HOODRICH_MINIMUM_UNITS, HOODRICH_TOKEN, type HolderAccess, type HolderChallenge } from '../lib/pro-access';
import { fail, origin } from './public-security';
import { isPublicWalletGranted } from './public-wallet-grants';
type Db = { rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}> };
type Context = {address:string|null;proof_id:string|null;expires_at:string};
const RPC='https://rpc.mainnet.chain.robinhood.com';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function holderError():never { return fail(409,'HOLDER_PROOF','Wallet proof is unavailable or expired. Keep the same account and wallet, then request a fresh proof. Unlink before changing wallets.'); }
function wallet(value:unknown):string { try {if(typeof value!=='string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value))throw Error();return utils.getAddress(value);} catch {return fail(400,'HOLDER_ADDRESS','Enter a valid nonzero Ethereum wallet address.');} }
async function call(db:Db,name:string,args:Record<string,unknown>):Promise<any> {const {data,error}=await db.rpc(name,args);if(error)holderError();return data;}
async function context(db:Db,user:string,session:string):Promise<Context> {
  if(!uuid.test(user) || !/^[0-9a-f]{64}$/.test(session))holderError();
  const c=await call(db,'hood_holder_context',{p_user:user,p_session:session});
  if(!c || (c.address!==null && wallet(c.address).toLowerCase()!==c.address) || (c.proof_id!==null && (!uuid.test(c.proof_id) || !c.address)) || !Number.isFinite(Date.parse(c.expires_at)) || Date.parse(c.expires_at)<=Date.now())holderError();
  return c;
}
function message(user:string,session:string,address:string,id:string,nonce:string,issued:string,expires:string):string {
  const site=origin();
  return `${new URL(site).host} wants you to sign in with your Ethereum account:\n${wallet(address)}\n\nVerify this wallet for HOODLABS holder access. This does not authorize transactions or token approvals.\n\nURI: ${site}/\nVersion: 1\nChain ID: ${HOODRICH_CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${issued}\nExpiration Time: ${expires}\nRequest ID: ${id}\nResources:\n- urn:hoodlabs:account:${user}\n- urn:hoodlabs:session:${session}`;
}
export async function holderChallenge(db:Db,user:string,session:string,input:unknown):Promise<HolderChallenge> {
  const address=wallet(input),c=await context(db,user,session);
  if(c.address && c.address!==address.toLowerCase())holderError();
  const now=Date.now(),challengeId=randomUUID(),nonce=randomBytes(16).toString('hex'),issued=new Date(now).toISOString(),expires=new Date(Math.min(now+300000,Date.parse(c.expires_at))).toISOString();
  const text=message(user,session,address,challengeId,nonce,issued,expires);
  if(await call(db,'hood_holder_challenge',{p_user:user,p_session:session,p_id:challengeId,p_address:address.toLowerCase(),p_nonce:nonce,p_message:text,p_issued:issued,p_expires:expires})!==true)holderError();
  return {challengeId,message:text,address,chainId:HOODRICH_CHAIN_ID};
}
export async function readHolderBalance(address:string):Promise<string> {
  const p=new providers.JsonRpcProvider({url:RPC,timeout:12000});
  try {
    if(await p.send('eth_chainId',[])!=='0x1237')throw Error();
    const head=await p.getBlockNumber();if(!Number.isSafeInteger(head) || head<2)throw Error();
    const number=head-1,block=await p.getBlock(number);
    if(!block || block.number!==number || !/^0x[0-9a-fA-F]{64}$/.test(block.hash))throw Error();
    const token=new Contract(HOODRICH_TOKEN,['function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)'],p);
    const [code,tokenCode,decimals,balance]=await Promise.all([p.getCode(address,number),p.getCode(HOODRICH_TOKEN,number),token.decimals({blockTag:number}),token.balanceOf(address,{blockTag:number})]);
    if(code!=='0x')fail(400,'HOLDER_EOA','Use a standard wallet. Contract and delegated wallets are not supported for holder proof yet.');
    if(typeof tokenCode!=='string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(tokenCode) || decimals!==HOODRICH_DECIMALS || !BigNumber.isBigNumber(balance) || balance.lt(0))throw Error();
    const [canonical,currentHead,chain]=await Promise.all([p.getBlock(number),p.getBlockNumber(),p.send('eth_chainId',[])]);
    if(!canonical || canonical.number!==number || canonical.hash!==block.hash || !Number.isSafeInteger(currentHead) || currentHead<number+1 || chain!=='0x1237')throw Error();
    return balance.toString();
  } finally {p.removeAllListeners();}
}
export async function verifyHolder(db:Db,user:string,session:string,id:unknown,signature:unknown):Promise<void> {
  if(typeof id!=='string' || !uuid.test(id) || typeof signature!=='string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))holderError();
  await context(db,user,session);
  const c=await call(db,'hood_holder_read_challenge',{p_user:user,p_session:session,p_id:id});
  if(!c || c.id!==id || c.user_id!==user || c.session_hash!==session || c.consumed!==false || typeof c.nonce!=='string' || !/^[0-9a-f]{32}$/.test(c.nonce))holderError();
  const issued=new Date(c.issued_at).toISOString(),expires=new Date(c.expires_at).toISOString();
  if(Date.parse(issued)>Date.now()+30000 || Date.parse(expires)<=Date.now() || Date.parse(expires)-Date.parse(issued)>300000 || c.message!==message(user,session,c.address,id,c.nonce,issued,expires))holderError();
  let recovered:string;try{recovered=utils.verifyMessage(c.message,signature);}catch{return holderError();}
  if(recovered.toLowerCase()!==wallet(c.address).toLowerCase())holderError();
  await readHolderBalance(c.address); // Also verifies EOA/token/chain; holdings grant eligibility separately.
  if(Date.parse(expires)<=Date.now())holderError();
  if(await call(db,'hood_holder_consume',{p_user:user,p_session:session,p_id:id,p_address:c.address,p_message:c.message})!==true)holderError();
}
export async function holderAccess(db:Db,user:string,session:string):Promise<HolderAccess> {
  const c=await context(db,user,session);
  if(!c.address || !c.proof_id)return {...EMPTY_HOLDER_ACCESS,address:c.address};
  try {
    const balance=await readHolderBalance(c.address),current=await context(db,user,session);
    if(current.address!==c.address || current.proof_id!==c.proof_id)return {...EMPTY_HOLDER_ACCESS,address:current.address};
    return {address:c.address,verified:true,eligible:BigNumber.from(balance).gte(HOODRICH_MINIMUM_UNITS),granted:isPublicWalletGranted(c.address),balance,unavailable:false};
  } catch {return {address:c.address,verified:false,eligible:false,granted:false,balance:null,unavailable:true};}
}
export async function unlinkHolder(db:Db,user:string,session:string):Promise<void> {
  await context(db,user,session);
  if(await call(db,'hood_holder_unlink',{p_user:user,p_session:session})!==true)holderError();
}
