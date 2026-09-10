import { BigNumber, providers, utils } from 'ethers';
import { RELAY_SOURCE_HASH, verifyRuntime } from './trusted-runtime';
import { hashRelayOrder } from './relay-order';

const ZERO = '0x0000000000000000000000000000000000000000';
// Pinned against official relay-settlement production deployments and /chains.
export const RELAY_DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const ROUTER = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
const SOURCE_RPC = 'https://ethereum.publicnode.com';
const DEST_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const API = 'https://api.relay.link';
const PREFIX = 'forge:relay:1:4663:';
const SLIPPAGE = 50;
const ABI = new utils.Interface([
  'function depositNative(address depositor,bytes32 id) payable',
  'event RelayNativeDeposit(address from,uint256 amount,bytes32 id)',
  'event FundsMovement(address from,address to,address currency,uint256 amount,bytes metadata)',
]);

export interface NodeBridgeReview {
  readonly nodeAddress: string; readonly nodeIndex: number; readonly requestId: string;
  readonly amountWei: string; readonly expectedOutputWei: string; readonly minimumOutputWei: string;
  readonly relayFeeWei: string; readonly maxGasCostWei: string; readonly maxTotalWei: string;
  readonly sourceBalanceWei: string; readonly balanceAfterMaxCostWei: string;
  readonly gasLimit: string; readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string;
  readonly slippageBps: number; readonly expiresAt: number;
}
export interface NodeBridgeOperation {
  readonly nodeAddress: string; readonly requestId: string; readonly sourceTxHash: string;
  readonly status: 'pending' | 'source-confirmed' | 'complete' | 'refunded' | 'failed' | 'unknown';
  readonly message: string; readonly createdAt: number; readonly destinationTxHash?: string;
}
type RecordData = { -readonly [K in keyof NodeBridgeOperation]: NodeBridgeOperation[K] } & {
  version: 1; orderId: string; amountWei: string; minimumOutputWei: string; nonce: number;
};
type Capability = { owner: object; tx: providers.TransactionRequest; orderId: string; used: boolean };
const reviews = new WeakMap<NodeBridgeReview, Capability>();
type Obj = Record<string, any>;
const fail = (): never => { throw new Error('Relay returned an unsupported or mismatched ETH route. No transaction was signed.'); };
const obj = (x: unknown): Obj => x && typeof x === 'object' && !Array.isArray(x) ? x as Obj : fail();
const address = (x: unknown): string => typeof x === 'string' && /^0x[\da-fA-F]{40}$/.test(x) ? utils.getAddress(x) : fail();
const same = (a: unknown, b: string): boolean => address(a).toLowerCase() === b.toLowerCase();
const hash = (x: unknown): string => typeof x === 'string' && /^0x[\da-fA-F]{64}$/.test(x) ? x.toLowerCase() : fail();
const uint = (x: unknown): BigNumber => typeof x === 'string' && /^(0|[1-9]\d{0,77})$/.test(x) && BigNumber.from(x).lte('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') ? BigNumber.from(x) : fail();
function exact(x: unknown, keys: string[]): Obj {
  const value = obj(x); if (Object.keys(value).length !== keys.length || !keys.every(k => k in value)) fail(); return value;
}
function currency(x: unknown, chain: number): void {
  const c = obj(x); if (c.chainId !== chain || !same(c.address, ZERO) || c.decimals !== 18) fail();
}
function amount(x: unknown, chain: number, expected?: BigNumber): BigNumber {
  const a = obj(x); currency(a.currency, chain); const n = uint(a.amount); if (expected && !n.eq(expected)) fail(); return n;
}

// Exported for deterministic auditing; validation alone never grants signing.
export function validateRelayQuote(value: unknown, node: string, input: string, now = Date.now()): {
  requestId: string; orderId: string; data: string; expected: string; minimum: string; fee: string; orderExpiresAt: number;
} {
  const q = obj(value), d = obj(q.details), v = obj(obj(q.protocol).v2);
  const inputWei = uint(input); if (inputWei.isZero()) fail();
  if (!same(d.sender, node) || !same(d.recipient, node)) fail();
  amount(d.currencyIn, 1, inputWei); amount(d.refundCurrency, 1, inputWei);
  const expected = amount(d.currencyOut, 4663), minimum = uint(d.currencyOut.minimumAmount);
  if (expected.isZero() || expected.gt(inputWei) || minimum.isZero() || minimum.gt(expected) ||
      minimum.lt(expected.mul(10000 - SLIPPAGE).div(10000)) || String(obj(d.slippageTolerance).total) !== String(SLIPPAGE)) fail();
  const fee = amount(obj(q.fees).relayer, 1);
  if (!expected.add(fee).eq(inputWei) || !amount(q.fees.app, 1).isZero()) fail();
  const order = exact(v.orderData, ['version','solverChainId','solver','salt','inputs','output','fees']);
  if (v.hubType !== 'onchain' || order.version !== 'v1' || order.solverChainId !== 'base' ||
      !same(order.solver, '0xf70da97812cb96acdf810712aa562db8dfa3dbef')) fail();
  hash(order.salt);
  if (!Array.isArray(order.inputs) || order.inputs.length !== 1 || !Array.isArray(order.fees) || order.fees.length) fail();
  const i = exact(order.inputs[0], ['payment','refunds']);
  const p = exact(i.payment, ['chainId','currency','amount','weight']);
  if (p.chainId !== 'ethereum' || !same(p.currency,ZERO) || !uint(p.amount).eq(inputWei) || p.weight !== '1') fail();
  const extra = utils.defaultAbiCoder.encode(['address'],[ROUTER]).toLowerCase();
  const o = exact(order.output,['chainId','payments','calls','deadline','extraData']);
  if (o.chainId !== 'robinhood' || !Array.isArray(o.calls) || o.calls.length || !Array.isArray(o.payments) || o.payments.length !== 1 ||
      !Number.isInteger(o.deadline) || o.deadline <= now / 1000 + 90 || o.deadline > now / 1000 + 8 * 86400 || o.extraData !== extra) fail();
  const pay = exact(o.payments[0],['recipient','currency','minimumAmount','expectedAmount']);
  if (!same(pay.recipient,node) || !same(pay.currency,ZERO) || !uint(pay.minimumAmount).eq(minimum) || !uint(pay.expectedAmount).eq(expected)) fail();
  if (!Array.isArray(i.refunds) || i.refunds.length !== 2) fail();
  for (let n=0;n<2;n++) {
    const r = exact(i.refunds[n],['chainId','recipient','currency','minimumAmount','deadline','extraData']);
    if (r.chainId !== ['ethereum','robinhood'][n] || !same(r.recipient,node) || !same(r.currency,ZERO) || r.minimumAmount !== '0' || r.deadline !== o.deadline || r.extraData !== extra) fail();
  }
  const orderId = hash(v.orderId);
  if (hashRelayOrder(order).toLowerCase() !== orderId) fail();
  const pd = exact(v.paymentDetails,['chainId','depository','currency','amount']);
  if (pd.chainId !== 'ethereum' || !same(pd.depository,RELAY_DEPOSITORY) || !same(pd.currency,ZERO) || !uint(pd.amount).eq(inputWei)) fail();
  const requestId = hash(q.requestId);
  if (!Array.isArray(q.steps) || q.steps.length !== 1) fail();
  const step = obj(q.steps[0]);
  if (step.id !== 'deposit' || step.kind !== 'transaction' || hash(step.requestId) !== requestId || !Array.isArray(step.items) || step.items.length !== 1) fail();
  const item = obj(step.items[0]), tx = obj(item.data);
  const data = ABI.encodeFunctionData('depositNative',[node,orderId]);
  if (item.status !== 'incomplete' || !same(tx.from,node) || !same(tx.to,RELAY_DEPOSITORY) || tx.chainId !== 1 ||
      !uint(tx.value).eq(inputWei) || typeof tx.data !== 'string' || tx.data.toLowerCase() !== data.toLowerCase() ||
      obj(item.check).method !== 'GET' || item.check.endpoint !== `/intents/status/v3?requestId=${requestId}`) fail();
  return {requestId,orderId,data,expected:expected.toString(),minimum:minimum.toString(),fee:fee.toString(),orderExpiresAt:o.deadline*1000};
}

async function api(path: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),15000);
  try {
    const response = await fetch(API + path, {method: body ? 'POST':'GET', headers: body ? {'Content-Type':'application/json'} : {},
      body: body ? JSON.stringify(body):undefined, signal:controller.signal, credentials:'omit', redirect:'error'});
    if (!response.ok) throw Error();
    const text = await response.text(); if (text.length > 512000) throw Error(); return JSON.parse(text);
  } catch { throw new Error('Relay could not be reached. No automatic retry was made.'); }
  finally { clearTimeout(timer); }
}
function provider(destination = false): providers.JsonRpcProvider {
  return new providers.JsonRpcProvider({url:destination ? DEST_RPC:SOURCE_RPC,timeout:15000});
}
async function chain(p: providers.JsonRpcProvider, expected: number): Promise<void> {
  if (BigNumber.from(await p.send('eth_chainId',[])).toNumber() !== expected) throw new Error('The RPC returned the wrong network.');
}
function storage(): Storage {
  if (typeof window === 'undefined' || !window.localStorage) throw new Error('Durable browser storage is required for safe bridging.');
  return window.localStorage;
}
function key(node: string): string { return PREFIX + address(node).toLowerCase(); }
function read(node: string): RecordData | null {
  try {
    const raw = storage().getItem(key(node)); if (!raw) return null;
    if (raw.length > 4096) throw Error();
    const r = obj(JSON.parse(raw));
    if (r.version !== 1 || !same(r.nodeAddress,node) || !Number.isSafeInteger(r.nonce) || r.nonce < 0 ||
        !Number.isSafeInteger(r.createdAt) || !['pending','source-confirmed','complete','refunded','failed','unknown'].includes(r.status) ||
        typeof r.message !== 'string' || r.message.length > 400) throw Error();
    hash(r.sourceTxHash); hash(r.requestId); hash(r.orderId);
    const deposit = uint(r.amountWei), minimum = uint(r.minimumOutputWei);
    if (deposit.isZero() || minimum.isZero() || minimum.gt(deposit) || r.createdAt <= 0 ||
        (r.status === 'complete' && !r.destinationTxHash)) throw Error();
    if (r.destinationTxHash) hash(r.destinationTxHash);
    return r as RecordData;
  } catch { throw new Error('Bridge recovery storage is unavailable or invalid. Resolve the existing operation before retrying.'); }
}
function save(r: RecordData): void {
  try { const encoded = JSON.stringify(r); const s=storage(); s.setItem(key(r.nodeAddress),encoded); if(s.getItem(key(r.nodeAddress))!==encoded)throw Error(); }
  catch { throw new Error('Could not persist bridge recovery information. Do not retry an uncertain transfer.'); }
}
function publicOperation(r: RecordData): NodeBridgeOperation {
  return Object.freeze({nodeAddress:r.nodeAddress,requestId:r.requestId,sourceTxHash:r.sourceTxHash,status:r.status,message:r.message,
    createdAt:r.createdAt,...(r.destinationTxHash ? {destinationTxHash:r.destinationTxHash}:{})});
}
export function getNodeBridgeOperation(node: string): NodeBridgeOperation | null {const r=read(node);return r ? publicOperation(r):null;}
function available(node: string): void {const old=read(node);if(old && old.status!=='complete' && old.status!=='failed')throw new Error('This node has an unresolved bridge. Check its status; do not send another deposit.');}

// Internal orchestration API. The vault owns authentication; no signer or secret is returned.
export async function prepareRelayBridge(owner: object,index: number,node: string,input: string,assertActive:()=>void): Promise<NodeBridgeReview> {
  assertActive(); available(node);
  if (!/^\d+(\.\d{1,18})?$/.test(input) || input.length > 80) throw new Error('Enter a positive ETH amount with at most 18 decimal places.');
  const amountWei = utils.parseEther(input); if(amountWei.lte(0))throw new Error('Enter a positive ETH amount.');
  const quote = await api('/quote/v2',{user:node,recipient:node,originChainId:1,destinationChainId:4663,originCurrency:ZERO,
    destinationCurrency:ZERO,amount:amountWei.toString(),tradeType:'EXACT_INPUT',slippageTolerance:String(SLIPPAGE),includeProtocolData:true});
  const route = validateRelayQuote(quote,node,amountWei.toString());
  const p=provider(), dest=provider(true);
  try {
    await Promise.all([chain(p,1),chain(dest,4663),verifyRuntime(p,RELAY_DEPOSITORY,RELAY_SOURCE_HASH)]);
    const tx = {from:node,to:RELAY_DEPOSITORY,data:route.data,value:amountWei};
    const [balance,estimate,fees,nonce,latestNonce] = await Promise.all([p.getBalance(node,'pending'),p.estimateGas(tx),p.getFeeData(),p.getTransactionCount(node,'pending'),p.getTransactionCount(node,'latest')]);
    if(nonce!==latestNonce)throw new Error('This node already has a pending Ethereum transaction. Wait for it to confirm.');
    const gas=estimate.mul(120).add(99).div(100);
    if(gas.gt(150000) || !fees.maxFeePerGas || !fees.maxPriorityFeePerGas || fees.maxFeePerGas.lte(0) || fees.maxFeePerGas.gt(utils.parseUnits('100','gwei')) || fees.maxPriorityFeePerGas.gt(fees.maxFeePerGas))throw new Error('Ethereum gas cannot be safely quoted. Try again later.');
    const cost=gas.mul(fees.maxFeePerGas), total=amountWei.add(cost);
    if(balance.lt(total))throw new Error('This node needs the bridge amount plus Ethereum gas. Reduce the amount or fund it first.');
    assertActive(); available(node);
    const expiresAt=Math.min(Date.now()+90000,route.orderExpiresAt-30000);
    if(expiresAt<=Date.now())throw new Error('The bridge protocol deadline expired during preparation. Get a fresh quote.');
    const review:NodeBridgeReview=Object.freeze({nodeAddress:node,nodeIndex:index,requestId:route.requestId,amountWei:amountWei.toString(),expectedOutputWei:route.expected,
      minimumOutputWei:route.minimum,relayFeeWei:route.fee,maxGasCostWei:cost.toString(),maxTotalWei:total.toString(),sourceBalanceWei:balance.toString(),
      balanceAfterMaxCostWei:balance.sub(total).toString(),gasLimit:gas.toString(),maxFeePerGasWei:fees.maxFeePerGas.toString(),
      maxPriorityFeePerGasWei:fees.maxPriorityFeePerGas.toString(),slippageBps:SLIPPAGE,expiresAt});
    reviews.set(review,{owner,orderId:route.orderId,used:false,tx:Object.freeze({to:RELAY_DEPOSITORY,data:route.data,value:amountWei.toString(),chainId:1,type:2,
      nonce,gasLimit:gas.toString(),maxFeePerGas:fees.maxFeePerGas.toString(),maxPriorityFeePerGas:fees.maxPriorityFeePerGas.toString()})});
    return review;
  } catch(e) { if(e instanceof Error && /node|gas|network|bridge|session/.test(e.message))throw e;throw new Error('Could not verify Ethereum balance and gas. No transaction was signed.'); }
  finally {p.removeAllListeners();dest.removeAllListeners();}
}

export async function executeRelayBridge(owner: object,review:NodeBridgeReview,assertActive:()=>void,
  sign:(tx:providers.TransactionRequest)=>Promise<string>):Promise<NodeBridgeOperation> {
  assertActive(); const cap=reviews.get(review);
  if(!cap || cap.owner!==owner || cap.used)throw new Error('This bridge review is invalid or already used.');
  if(typeof navigator==='undefined' || !navigator.locks)throw new Error('Browser transaction locking is required for safe bridging.');
  return navigator.locks.request('forge:relay:ethereum:'+review.nodeAddress.toLowerCase(),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is operating this node.');
    assertActive();available(review.nodeAddress);
    if(cap.used || Date.now()>=review.expiresAt)throw new Error('The bridge review expired. Get a fresh quote.');
    const p=provider();
    try {
      await Promise.all([chain(p,1),verifyRuntime(p,RELAY_DEPOSITORY,RELAY_SOURCE_HASH)]);
      const [balance,nonce,latest,estimate,fees] = await Promise.all([p.getBalance(review.nodeAddress,'pending'),p.getTransactionCount(review.nodeAddress,'pending'),
        p.getTransactionCount(review.nodeAddress,'latest'),p.estimateGas({...cap.tx,from:review.nodeAddress}),p.getFeeData()]);
      if(balance.lt(review.maxTotalWei) || nonce!==cap.tx.nonce || latest!==nonce || estimate.gt(review.gasLimit) ||
          !fees.maxFeePerGas || fees.maxFeePerGas.gt(review.maxFeePerGasWei))throw new Error('Balance, nonce or gas changed. Get a fresh bridge quote.');
      await chain(p,1);assertActive();available(review.nodeAddress);
      if(Date.now()>=review.expiresAt)throw new Error('The bridge review expired. Get a fresh quote.');
      cap.used=true;
      const signed=await sign(cap.tx);assertActive();
      if(Date.now()>=review.expiresAt)throw new Error('The bridge review expired before submission. Get a fresh quote.');
      const decoded=utils.parseTransaction(signed);
      if(!same(decoded.from,review.nodeAddress) || decoded.chainId!==1 || decoded.to?.toLowerCase()!==RELAY_DEPOSITORY || decoded.data!==cap.tx.data ||
        !decoded.value.eq(review.amountWei) || decoded.nonce!==nonce || !decoded.gasLimit.eq(review.gasLimit) || decoded.type!==2 ||
        !decoded.maxFeePerGas?.eq(review.maxFeePerGasWei) || !decoded.maxPriorityFeePerGas?.eq(review.maxPriorityFeePerGasWei))throw new Error('The signed bridge transaction did not match its review.');
      const record:RecordData={version:1,nodeAddress:review.nodeAddress,requestId:review.requestId,sourceTxHash:utils.keccak256(signed),orderId:cap.orderId,
        amountWei:review.amountWei,minimumOutputWei:review.minimumOutputWei,nonce,status:'pending',message:'Deposit submitted or awaiting confirmation. Check status before any further action.',createdAt:Date.now()};
      save(record); // Persist hash BEFORE a possibly ambiguous broadcast. Never retain signed bytes.
      try {const result=await p.send('eth_sendRawTransaction',[signed]);if(hash(result)!==record.sourceTxHash)throw Error();}
      catch {record.status='unknown';record.message='Deposit outcome is uncertain. Check status; do not send again.';save(record);}
      return publicOperation(record);
    } finally {p.removeAllListeners();}
  });
}

export async function refreshNodeBridgeOperation(node:string):Promise<NodeBridgeOperation> {
  const r=read(node);if(!r)throw new Error('No bridge operation was recorded for this node.');
  if(typeof navigator==='undefined' || !navigator.locks)throw new Error('Browser transaction locking is required.');
  return navigator.locks.request('forge:relay:ethereum:'+address(node).toLowerCase(),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is operating this node.');
    const current=read(node);if(!current || current.sourceTxHash!==r.sourceTxHash)throw new Error('The bridge operation changed. Reload its status.');
    const p=provider(),d=provider(true);
    let deliveryProof: {blockNumber:number; blockHash:string; parentHash:string; txHash:string; to:string; from:string} | undefined;
    try {
      await Promise.all([chain(p,1),chain(d,4663)]);
      const [receipt,tx]=await Promise.all([p.getTransactionReceipt(r.sourceTxHash),p.getTransaction(r.sourceTxHash)]);
      if(!receipt || !tx) {r.status='unknown';r.message='Ethereum has not confirmed this deposit. Do not send another deposit.';}
      else {
        if(receipt.transactionHash.toLowerCase()!==r.sourceTxHash || !same(receipt.from,node) || !same(receipt.to,RELAY_DEPOSITORY) || ![0,1].includes(receipt.status!) || receipt.confirmations<2 ||
          tx.hash.toLowerCase()!==r.sourceTxHash || tx.chainId!==1 || !same(tx.from,node) || !same(tx.to,RELAY_DEPOSITORY) || tx.nonce!==r.nonce || !tx.value.eq(r.amountWei) ||
          tx.data.toLowerCase()!==ABI.encodeFunctionData('depositNative',[node,r.orderId]).toLowerCase())throw Error();
        if(!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber<0 || !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash))throw Error();
        const canonical=await p.getBlock(receipt.blockNumber);
        const head=await p.getBlockNumber();
        if(!canonical || canonical.hash!==receipt.blockHash || !Number.isSafeInteger(head) || head<receipt.blockNumber+1)throw Error();
        await verifyRuntime(p,RELAY_DEPOSITORY,RELAY_SOURCE_HASH,receipt.blockNumber);
        if(receipt.status===0){
          // The exact deposit failed onchain. No deposit occurred; gas was spent.
          // Never infer this from Relay status or an error-attached receipt.
          r.status='failed';r.message='Ethereum deposit reverted. Gas was spent, but no bridge deposit occurred. You may request a fresh quote.';
          const finalBlock=await p.getBlock(receipt.blockNumber);
          if(!finalBlock || finalBlock.hash!==receipt.blockHash)throw Error();
          await chain(p,1);save(r);return publicOperation(r);
        }
        const deposit=receipt.logs.some(log=>{try {if(!same(log.address,RELAY_DEPOSITORY))return false;const event=ABI.parseLog(log);
          return event.name==='RelayNativeDeposit' && same(event.args.from,node) && event.args.amount.eq(r.amountWei) && event.args.id.toLowerCase()===r.orderId;}catch{return false;}});
        if(!deposit)throw Error();
        r.status='source-confirmed';r.message='Ethereum deposit confirmed. Robinhood delivery is not yet verified.';
        const result=obj(await api('/intents/status/v3?requestId='+r.requestId));
        if(result.originChainId!==1 || result.destinationChainId!==4663 || !Array.isArray(result.inTxHashes) || !result.inTxHashes.some((h:unknown)=>hash(h)===r.sourceTxHash))throw Error();
        if(result.status==='success' && Array.isArray(result.txHashes) && result.txHashes.length===1) {
          const destHash=hash(result.txHashes[0]);
          const [receipt,destTx]=await Promise.all([d.getTransactionReceipt(destHash),d.getTransaction(destHash)]);
          if(receipt && receipt.status===1 && receipt.confirmations>=2 && receipt.transactionHash.toLowerCase()===destHash &&
            (same(receipt.to,RELAY_DEPOSITORY)||same(receipt.to,ROUTER))) {
            if(!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber<1)throw Error();
            const blockHash=hash(receipt.blockHash);
            if(!destTx || hash(destTx.hash)!==destHash || destTx.chainId!==4663 || destTx.blockNumber!==receipt.blockNumber || hash(destTx.blockHash)!==blockHash || !same(destTx.to,receipt.to) || !same(destTx.from,receipt.from))throw Error();
            const [block,parent,head]=await Promise.all([d.getBlock(receipt.blockNumber),d.getBlock(receipt.blockNumber-1),d.getBlockNumber()]);
            if(!block || !parent || block.number!==receipt.blockNumber || parent.number!==receipt.blockNumber-1 || hash(block.hash)!==blockHash || hash(block.parentHash)!==hash(parent.hash) || !Number.isSafeInteger(head) || head<receipt.blockNumber+1)throw Error();
            const [before,after,routerCode]=await Promise.all([d.getBalance(node,receipt.blockNumber-1),d.getBalance(node,receipt.blockNumber),d.getCode(ROUTER,receipt.blockNumber)]);
            // Deployed RelayRouterV3 emits this only after transferring native ETH.
            // Unknown metadata encodings cannot prove this order and remain unverified.
            const payment=receipt.logs.some(log=>{try {
              if(!same(log.address,ROUTER) || log.removed || log.blockNumber!==receipt.blockNumber || hash(log.blockHash)!==blockHash || hash(log.transactionHash)!==destHash)return false;
              const event=ABI.parseLog(log);return event.name==='FundsMovement' && same(event.args.from,ROUTER) &&
                same(event.args.to,node) && same(event.args.currency,ZERO) && event.args.amount.gte(r.minimumOutputWei) &&
                String(event.args.metadata).toLowerCase()===r.orderId;
            }catch{return false;}});
            // A balance delta is conservative: spending within that block can leave completion unverified.
            if(payment && utils.keccak256(routerCode)==='0xde894e5c12e9513d50613c8fff375ecbf19b5d9a53bec0662e2b9667e3ec8f15' && after.gte(before.add(r.minimumOutputWei))) {deliveryProof={blockNumber:receipt.blockNumber,blockHash,parentHash:hash(parent.hash),txHash:destHash,to:receipt.to,from:receipt.from};}
          }
        } else if(result.status==='refund' || result.status==='failure') {
          r.status='unknown';r.message='Relay reported a refund or failure. Reconcile the recorded transaction before any further deposit.';
        }
      }
      await Promise.all([chain(p,1),chain(d,4663)]);
      if(deliveryProof) {
        // Number-tagged balance/runtime reads are accepted only while both blocks remain canonical.
        // Recheck source and destination after every asynchronous proof read and before persistence.
        const proof=deliveryProof;
        const [block,parent,head,mined,sourceBlock,sourceHead]=await Promise.all([d.getBlock(proof.blockNumber),d.getBlock(proof.blockNumber-1),d.getBlockNumber(),d.getTransaction(proof.txHash),p.getBlock(receipt!.blockNumber),p.getBlockNumber()]);
        if(!block || !parent || hash(block.hash)!==proof.blockHash || hash(parent.hash)!==proof.parentHash || hash(block.parentHash)!==proof.parentHash || !Number.isSafeInteger(head) || head<proof.blockNumber+1 ||
          !mined || hash(mined.hash)!==proof.txHash || mined.chainId!==4663 || mined.blockNumber!==proof.blockNumber || hash(mined.blockHash)!==proof.blockHash || !same(mined.to,proof.to) || !same(mined.from,proof.from) ||
          !sourceBlock || sourceBlock.hash!==receipt!.blockHash || !Number.isSafeInteger(sourceHead) || sourceHead<receipt!.blockNumber+1)throw Error();
        r.status='complete';r.destinationTxHash=proof.txHash;r.message='Relay delivery confirmed and ETH received on Robinhood Chain.';
      }
    } catch {r.status='unknown';r.message='Could not conclusively verify this bridge. Preserve the transaction hash and check again; do not resend.';}
    finally {p.removeAllListeners();d.removeAllListeners();}
    save(r);return publicOperation(r);
  });
}
