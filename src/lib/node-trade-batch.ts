import { BigNumber } from 'ethers';
import { MAX_NODES, isVerifiedNodeSession, prepareNodeTrade, executeNodeTrade } from './node-vault';
import type { NodeSession } from './node-vault';
import { tradeAddress } from './pons-trade';
import type { NodeTradeSide } from './pons-trade';
import type { NodeTradeReview, NodeTradeOperation } from './node-trading';
import { retireNodeTradeReview, assertNodeTradeReviewRoute } from './node-trading';

export interface NodeTradeBatchEntry {
  readonly nodeIndex:number; readonly nodeAddress:string;
  readonly status:'ready'|'blocked'|'deferred'; readonly review?:NodeTradeReview; readonly error?:string;
}
export interface NodeTradeBatch {
  readonly tokenAddress:string; readonly side:NodeTradeSide; readonly mode:'trades'|'approvals';
  readonly entries:readonly NodeTradeBatchEntry[]; readonly expiresAt:number;
  readonly maxGasCostWei:string; readonly maxTotalEthWei:string;
}
export interface NodeTradeBatchResult {
  readonly nodeIndex:number; readonly nodeAddress:string;
  readonly status:'submitted'|'unknown'|'error'|'not-submitted'; readonly operation?:NodeTradeOperation; readonly error?:string;
  readonly renewed?:boolean;
}
const BATCH_INTENT_MS=5*60*1000;
const RENEW_BEFORE_MS=15000;
const batches=new WeakMap<NodeTradeBatch,{session:NodeSession;used:boolean}>();
function errorText(error:unknown):string {return error instanceof Error?error.message.slice(0,300):'The node action could not be completed.';}
function active(session:NodeSession,assertCurrent:()=>void):void {
  assertCurrent();
  if(!isVerifiedNodeSession(session))throw new Error('Restore a verified node session before trading.');
}
function approval(review:NodeTradeReview):boolean{return review.action==='approve-token'||review.action==='approve-router';}
function validateReview(review:NodeTradeReview,index:number,node:string,token:string,side:NodeTradeSide):void {
  if(!Object.isFrozen(review)||review.nodeIndex!==index||tradeAddress(review.nodeAddress)!==node||tradeAddress(review.tokenAddress)!==token||
    review.side!==side||review.percent!==100||(side==='buy'?review.action!=='buy':!['sell','approve-token','approve-router'].includes(review.action))||
    !Number.isSafeInteger(review.expiresAt)||review.expiresAt<=Date.now())throw new Error('The node trade review does not match this batch.');
  for(const amount of [review.maxGasCostWei,review.maxTotalEthWei])if(typeof amount!=='string'||!/^(0|[1-9]\d{0,77})$/.test(amount))throw new Error('The node trade cost is invalid.');
}

export async function prepareNodeTradeBatch(session:NodeSession,token:string,side:NodeTradeSide,assertCurrent:()=>void):Promise<NodeTradeBatch> {
  active(session,assertCurrent);token=tradeAddress(token);
  const expiresAt=Date.now()+BATCH_INTENT_MS;
  const assertIntent=()=>{active(session,assertCurrent);if(Date.now()>=expiresAt)throw new Error('The batch intent expired. Prepare a fresh batch.');};
  if(side!=='buy'&&side!=='sell')throw new Error('Choose Buy or Sell.');
  if(session.addresses.length<1||session.addresses.length>MAX_NODES)throw new Error('The node batch size is invalid.');
  const nodes=session.addresses.map(tradeAddress);
  if(new Set(nodes).size!==nodes.length)throw new Error('A node can appear only once in a trade batch.');
  const entries:NodeTradeBatchEntry[]=new Array(nodes.length);let next=0;
  async function worker():Promise<void>{
    while(next<nodes.length){
      assertIntent();const index=next++,node=nodes[index];
      try{
        const review=await prepareNodeTrade(session,index,token,side,100);active(session,assertCurrent);
        validateReview(review,index,node,token,side);entries[index]={nodeIndex:index,nodeAddress:node,status:'ready',review};
      }catch(error){entries[index]={nodeIndex:index,nodeAddress:node,status:'blocked',error:errorText(error)};}
    }
  }
  await Promise.all(Array.from({length:Math.min(3,nodes.length)},()=>worker()));assertIntent();
  const mode=entries.some(entry=>entry.review&&approval(entry.review))?'approvals':'trades';
  let maxGas=BigNumber.from(0),maxTotal=BigNumber.from(0);
  const frozen=entries.map(entry=>{
    if(mode==='approvals'&&entry.review&&!approval(entry.review))entry={...entry,status:'deferred',error:'This sale is deferred until the approval-only batch is confirmed. Prepare Sell Max All again afterward.'};
    if(entry.status==='ready'&&entry.review){
      maxGas=maxGas.add(entry.review.maxGasCostWei);maxTotal=maxTotal.add(entry.review.maxTotalEthWei);
    }
    return Object.freeze(entry);
  });
  const batch:NodeTradeBatch=Object.freeze({tokenAddress:token,side,mode,entries:Object.freeze(frozen),expiresAt,maxGasCostWei:maxGas.toString(),maxTotalEthWei:maxTotal.toString()});
  batches.set(batch,{session,used:false});return batch;
}

export async function executeNodeTradeBatch(session:NodeSession,batch:NodeTradeBatch,assertCurrent:()=>void,onProgress?:(result:NodeTradeBatchResult)=>void):Promise<readonly NodeTradeBatchResult[]> {
  const cap=batches.get(batch);
  if(!cap||cap.session!==session||cap.used)throw new Error('This batch review is invalid or already used.');
  active(session,assertCurrent);
  if(batch.expiresAt<=Date.now()||!batch.entries.some(entry=>entry.status==='ready'))throw new Error('No current executable batch review exists. Prepare a fresh batch.');
  // Consume before the first await: duplicate clicks can never enter a second loop.
  cap.used=true;const results:NodeTradeBatchResult[]=[];let stopped='';
  for(const entry of batch.entries){
    let result:NodeTradeBatchResult;
    const base={nodeIndex:entry.nodeIndex,nodeAddress:entry.nodeAddress};
    if(stopped||entry.status!=='ready'||!entry.review){result={...base,status:'not-submitted',error:stopped||entry.error||'This node was not included in the reviewed action subset.'};}
    else{
      const assertBatchCurrent=()=>{
        active(session,assertCurrent);
        if(Date.now()>=batch.expiresAt)throw new Error('The batch review expired. No remaining nodes will be submitted.');
      };
      // Cancellation between nodes leaves this node unsubmitted. Once its vault
      // operation starts, an error is retained without retry because it may have signed.
      try{assertBatchCurrent();}catch(error){stopped=errorText(error);}
      if(stopped)result={...base,status:'not-submitted',error:stopped};
      else try{
        let review=entry.review,renewed=false;
        if(Date.now()+RENEW_BEFORE_MS>=review.expiresAt){
          await retireNodeTradeReview(session,review,assertBatchCurrent);
          const fresh=await prepareNodeTrade(session,entry.nodeIndex,batch.tokenAddress,batch.side,100);
          assertBatchCurrent();validateReview(fresh,entry.nodeIndex,entry.nodeAddress,batch.tokenAddress,batch.side);
          assertNodeTradeReviewRoute(review,fresh);
          if(fresh.action!==review.action||fresh.phase!==review.phase||fresh.route!==review.route||fresh.amountInRaw!==review.amountInRaw||
            fresh.approvalSpender!==review.approvalSpender||fresh.minimumIsRateBound!==review.minimumIsRateBound||
            BigNumber.from(fresh.minimumOutputRaw).lt(review.minimumOutputRaw)||BigNumber.from(fresh.maxGasCostWei).gt(review.maxGasCostWei)||
            BigNumber.from(fresh.maxTotalEthWei).gt(review.maxTotalEthWei)||BigNumber.from(fresh.maxFeePerGasWei).gt(review.maxFeePerGasWei)||
            BigNumber.from(fresh.maxPriorityFeePerGasWei).gt(review.maxPriorityFeePerGasWei))throw new Error('The renewed trade no longer fits the original amount, route, price or cost bounds. Prepare a new explicit batch.');
          review=fresh;renewed=true;
        }
        const operation=await executeNodeTrade(session,review,assertBatchCurrent);
        if(operation.nodeAddress!==entry.review.nodeAddress||operation.tokenAddress!==batch.tokenAddress||operation.action!==entry.review.action||operation.side!==batch.side||!['pending','confirmed','unknown'].includes(operation.status)){
          stopped='The node operation could not be matched conclusively. Check its status before any retry.';
          result={...base,status:'unknown',operation,error:stopped};
        }else{
          const unknown=operation.status==='unknown';
          result={...base,status:unknown?'unknown':'submitted',operation,...(renewed?{renewed:true}:{})};
          if(unknown)stopped='A node transaction has an uncertain outcome. Check its recorded hash before preparing another batch.';
        }
      }catch(error){stopped=errorText(error);result={...base,status:'error',error:stopped};}
    }
    const frozen=Object.freeze(result);results.push(frozen);
    // Observers display evidence only; exceptions must not lose the results.
    try{onProgress?.(frozen);}catch{/* The next iteration still checks all guards. */}
  }
  return Object.freeze(results);
}
