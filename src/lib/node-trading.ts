import { BigNumber, Contract, providers, utils } from 'ethers';
import {
  TRADE_CHAIN_ID, TRADE_SLIPPAGE_BPS, TRADE_TOKEN_ABI, TRADE_CURVE_ABI, TRADE_PERMIT_ABI, TRADE_PERMIT2, TRADE_ROUTER, TRADE_QUOTER,
  TRADE_QUOTER_ABI, TRADE_POOL_MANAGER, tradeAddress, tradeProvider, assertTradeChain, verifyTradeCode, readTradeLaunch,
  assertLaunchTradable, percentageAmount, copyTradeAmount, parseTradeAmount, readCurveQuote, quoteCurveBuy, quoteCurveSell, poolKey, encodeV4Trade,
} from './pons-trade';
import type { NodeTradePercent, NodeTradeAmount, NodeTradeSide, TradeLaunch, CurveQuoteState } from './pons-trade';

export type NodeTradeAction = 'buy' | 'sell' | 'approve-token' | 'approve-router';
export interface NodeTradeReview {
  readonly nodeAddress: string; readonly nodeIndex: number; readonly tokenAddress: string; readonly symbol: string;
  readonly decimals: number; readonly phase: 0 | 2; readonly side: NodeTradeSide; readonly percent: NodeTradePercent | null; readonly customAmount?: string;
  readonly action: NodeTradeAction; readonly route: 'PONS curve' | 'Uniswap v4'; readonly amountInRaw: string;
  readonly expectedOutputRaw: string; readonly minimumOutputRaw: string; readonly minimumIsRateBound: boolean;
  readonly expectedSpendWei: string; readonly expectedRefundWei: string; readonly ethBalanceWei: string; readonly tokenBalanceRaw: string;
  readonly maxGasCostWei: string; readonly maxTotalEthWei: string; readonly gasReserveWei: string; readonly requiredRemainingEthWei: string; readonly balanceAfterMaxCostWei: string;
  readonly gasLimit: string; readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string;
  readonly slippageBps: typeof TRADE_SLIPPAGE_BPS; readonly expiresAt: number; readonly approvalSpender?: string; readonly approvalExpiresAt?: number;
}
export interface NodeTradeOperation {
  readonly nodeAddress: string; readonly tokenAddress: string; readonly action: NodeTradeAction; readonly side: NodeTradeSide;
  readonly txHash: string; readonly status: 'pending' | 'confirmed' | 'failed' | 'unknown'; readonly message: string; readonly createdAt: number;
}
// Per-node Robinhood signing lock, shared by approvals and swaps across every token.
const LOCK_PREFIX='forge:node:4663:';
const STORAGE_PREFIX='forge:node-trade:4663:';
const GAS_CAP=BigNumber.from(3000000);
const GAS_FLOOR=utils.parseEther('0.00005');
const GAS_REFINEMENT_LIMIT=6;
function paddedGas(estimate:BigNumber):BigNumber {
  const gas=estimate.mul(130).add(99).div(100);
  if(gas.lte(0)||gas.gt(GAS_CAP))throw new Error('Estimated trade gas exceeds the supported bound.');
  return gas;
}
function assertAffordable(balance:BigNumber,total:BigNumber,futureReserve:BigNumber):void {
  const upfront=balance.lt(total),needed=total.add(futureReserve);
  if(balance.gte(needed))return;
  const reason=upfront?'upfront transaction gas and value':'reviewed cost and gas reserve for following steps';
  const reserve=futureReserve.isZero()?'':`, reserve ${utils.formatEther(futureReserve)}`;
  throw new Error(`This node has insufficient ETH for ${reason}. Balance ${utils.formatEther(balance)}, need ${utils.formatEther(needed)}, shortfall ${utils.formatEther(needed.sub(balance))} ETH${reserve}. Fund the node, refresh balances, and prepare a fresh trade.`);
}
const reviews=new WeakMap<NodeTradeReview,{owner:object;used:boolean;tx:providers.TransactionRequest;launch:TradeLaunch;minimum:BigNumber;approvalExpiration?:number}>();
const tokenInterface=new utils.Interface(TRADE_TOKEN_ABI),curveInterface=new utils.Interface(TRADE_CURVE_ABI),permitInterface=new utils.Interface(TRADE_PERMIT_ABI);
interface TradeRecord {
  version:1;nodeAddress:string;tokenAddress:string;action:NodeTradeAction;side:NodeTradeSide;txHash:string;
  status:NodeTradeOperation['status'];message:string;createdAt:number;to:string;data:string;value:string;nonce:number;
  phase:0|2;curve:string;amountInRaw:string;minimumOutputRaw:string;approvalSpender?:string;approvalExpiration?:number;
}
function read(node:string):TradeRecord|null {
  try{
    if(typeof window==='undefined'||!window.localStorage)throw Error();
    const raw=window.localStorage.getItem(STORAGE_PREFIX+tradeAddress(node).toLowerCase());if(!raw)return null;if(raw.length>20000)throw Error();
    const r=JSON.parse(raw) as TradeRecord;
    if(r.version!==1||tradeAddress(r.nodeAddress)!==tradeAddress(node)||!['buy','sell','approve-token','approve-router'].includes(r.action)||!['buy','sell'].includes(r.side)||
      !['pending','confirmed','failed','unknown'].includes(r.status)||!/^0x[0-9a-f]{64}$/.test(r.txHash)||!/^0x([0-9a-fA-F]{2})+$/.test(r.data)||
      !Number.isSafeInteger(r.nonce)||r.nonce<0||!Number.isSafeInteger(r.createdAt)||r.createdAt<=0||![0,2].includes(r.phase)||typeof r.message!=='string'||r.message.length>400)throw Error();
    tradeAddress(r.to);tradeAddress(r.tokenAddress);tradeAddress(r.curve);
    for(const n of [r.value,r.amountInRaw,r.minimumOutputRaw])if(typeof n!=='string'||!/^(0|[1-9]\d{0,77})$/.test(n))throw Error();
    if(BigNumber.from(r.amountInRaw).lte(0)||((r.action==='buy'||r.action==='sell')&&BigNumber.from(r.minimumOutputRaw).lte(0)))throw Error();
    return r;
  }catch{throw new Error('Trading recovery storage is invalid or unavailable. Resolve any existing transaction before retrying.');}
}
function save(r:TradeRecord):void {
  try{const key=STORAGE_PREFIX+r.nodeAddress.toLowerCase(),raw=JSON.stringify(r);window.localStorage.setItem(key,raw);if(window.localStorage.getItem(key)!==raw)throw Error();}
  catch{throw new Error('Could not persist trading recovery information. Do not retry an uncertain transaction.');}
}
function publicRecord(r:TradeRecord):NodeTradeOperation{return Object.freeze({nodeAddress:r.nodeAddress,tokenAddress:r.tokenAddress,action:r.action,side:r.side,txHash:r.txHash,status:r.status,message:r.message,createdAt:r.createdAt});}
export function getNodeTradeOperation(node:string):NodeTradeOperation|null {const r=read(node);return r?publicRecord(r):null;}
function available(node:string):void{const r=read(node);if(r&&r.status!=='confirmed'&&r.status!=='failed')throw new Error('This node has an unresolved Robinhood transaction. Check status before trading again.');}
function validSide(side:NodeTradeSide):void{if(side!=='buy'&&side!=='sell')throw new Error('Choose Buy or Sell.');}
async function feesAndNonce(p:providers.JsonRpcProvider,node:string):Promise<{fee:BigNumber;tip:BigNumber;baseFee:BigNumber;nonce:number}> {
  const [fees,pending,latest]=await Promise.all([p.getFeeData(),p.getTransactionCount(node,'pending'),p.getTransactionCount(node,'latest')]);
  if(pending!==latest)throw new Error('This node already has a pending Robinhood transaction. Wait for confirmation.');
  if(!BigNumber.isBigNumber(fees.lastBaseFeePerGas)||fees.lastBaseFeePerGas.lt(0))throw new Error('The current Robinhood base fee could not be safely verified. Prepare a fresh trade.');
  if(!fees.maxFeePerGas||!fees.maxPriorityFeePerGas||fees.maxFeePerGas.lte(0)||fees.maxFeePerGas.gt(utils.parseUnits('100','gwei'))||fees.maxPriorityFeePerGas.gt(fees.maxFeePerGas))throw new Error('Robinhood gas cannot be safely quoted.');
  return {fee:fees.maxFeePerGas,tip:fees.maxPriorityFeePerGas,baseFee:fees.lastBaseFeePerGas,nonce:pending};
}
async function quote(p:providers.JsonRpcProvider,launch:TradeLaunch,node:string,side:NodeTradeSide,input:BigNumber,block:number,curveState?:CurveQuoteState):Promise<{output:BigNumber;minimum:BigNumber;spent:BigNumber;refund:BigNumber}> {
  if(launch.phase===0){
    const state=curveState||await readCurveQuote(p,launch,node,block);
    if(side==='buy'){const q=quoteCurveBuy(state,input);return {output:q.output,minimum:q.minimumRateOutput,spent:q.spent,refund:q.refund};}
    const output=quoteCurveSell(state,input);return {output,minimum:output.mul(10000-TRADE_SLIPPAGE_BPS).div(10000),spent:BigNumber.from(0),refund:BigNumber.from(0)};
  }
  if(input.gt('0xffffffffffffffffffffffffffffffff'))throw new Error('Trade exceeds the v4 input bound.');
  const quoter=new Contract(TRADE_QUOTER,TRADE_QUOTER_ABI,p);
  const result=await quoter.callStatic.quoteExactInputSingle([poolKey(launch),side==='buy',input,'0x'],{from:node,blockTag:block});
  const output=BigNumber.from(result.amountOut??result[0]);
  if(output.lte(0)||output.gt('0xffffffffffffffffffffffffffffffff'))throw new Error('The pool could not quote this amount.');
  return {output,minimum:output.mul(10000-TRADE_SLIPPAGE_BPS).div(10000),spent:side==='buy'?input:BigNumber.from(0),refund:BigNumber.from(0)};
}
function sameLaunch(a:TradeLaunch,b:TradeLaunch):boolean{return a.token===b.token&&a.curve===b.curve&&a.phase===b.phase&&a.poolFee===b.poolFee&&a.tickSpacing===b.tickSpacing;}

export async function prepareTrade(owner:object,index:number,node:string,token:string,side:NodeTradeSide,amount:NodeTradeAmount,assertActive:()=>void):Promise<NodeTradeReview> {
  assertActive();node=tradeAddress(node);token=tradeAddress(token);validSide(side);const selection=copyTradeAmount(amount),percent=typeof selection==='number'?selection:null,customAmount=typeof selection==='number'?undefined:selection.amount;available(node);
  const p=tradeProvider();
  try{
    const [,block]=await Promise.all([assertTradeChain(p),p.getBlockNumber()]);
    const t=new Contract(token,TRADE_TOKEN_ABI,p),b={blockTag:block};
    const [launch,[balance,holding,symbol,decimals,feeData]]=await Promise.all([
      readTradeLaunch(p,token,block),
      Promise.all([p.getBalance(node,'pending'),t.balanceOf(node,b),t.symbol(b),t.decimals(b),feesAndNonce(p,node)]),
    ]);
    assertLaunchTradable(launch);
    if(typeof symbol!=='string'||symbol.length>64||!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Token metadata is invalid.');
    // The cap rejects unsafe estimates; it is not the gas every swap must afford.
    let reserve=GAS_FLOOR;
    if(side==='buy'&&balance.lte(GAS_FLOOR))throw new Error('This node needs more Robinhood ETH for trading and gas.');
    let input=customAmount!==undefined?parseTradeAmount(customAmount,side==='buy'?18:decimals):percentageAmount(side==='buy'?balance.sub(reserve):holding,percent!);
    if(input.gt(side==='buy'?balance:holding))throw new Error('The custom trade amount exceeds this node balance.');
    if(input.lte(0))throw new Error('This node has too little balance for the selected percentage.');
    if(launch.phase===2&&input.gt('0xffffffffffffffffffffffffffffffff'))throw new Error('Trade exceeds the v4 input bound.');
    const expiresAt=Date.now()+60000,deadline=Math.floor(expiresAt/1000);
    let action:NodeTradeAction=side,approvalSpender:string|undefined,approvalExpiration:number|undefined;
    let to=launch.phase===0?launch.curve:TRADE_ROUTER,data='',value=side==='buy'?input:BigNumber.from(0);
    if(side==='sell'){
      const spender=launch.phase===0?launch.curve:TRADE_PERMIT2,allowance=await t.allowance(node,spender,b);
      if(allowance.lt(input)){
        action='approve-token';approvalSpender=spender;to=token;value=BigNumber.from(0);data=tokenInterface.encodeFunctionData('approve',[spender,input]);
      }else if(launch.phase===2){
        const permit=new Contract(TRADE_PERMIT2,TRADE_PERMIT_ABI,p),a=await permit.allowance(node,token,TRADE_ROUTER,b);
        if(BigNumber.from(a.amount).lt(input)||Number(a.expiration)<deadline+30){
          if(input.gt('0xffffffffffffffffffffffffffffffffffffffff'))throw new Error('Token amount exceeds Permit2 bounds.');
          action='approve-router';approvalSpender=TRADE_ROUTER;approvalExpiration=deadline+540;to=TRADE_PERMIT2;value=BigNumber.from(0);
          data=permitInterface.encodeFunctionData('approve',[token,TRADE_ROUTER,input,approvalExpiration]);
        }
      }
    }
    const isApproval=action==='approve-token'||action==='approve-router';
    // Max leaves a route budget for separately reviewed approvals and a sale.
    // One padded buy-gas unit per approval and two for the sale cover the
    // documented gas envelope; future actions still require fresh estimates.
    const exitGasUnits=side==='buy'&&percent===100?(launch.phase===0?3:4):0;
    const futureGasReserve=(gas:BigNumber)=>GAS_FLOOR.add(gas.mul(feeData.fee).mul(exitGasUnits));
    const followingGasReserve=(gas:BigNumber)=>exitGasUnits?futureGasReserve(gas):action==='sell'?BigNumber.from(0):GAS_FLOOR.mul(isApproval&&launch.phase===2&&action==='approve-token'?2:1);
    // Reuse only this operation's block-pinned curve state across gas refinement.
    // Every execution below fetches its own fresh state and runtime verification.
    const [curveState]=await Promise.all([!isApproval&&launch.phase===0?readCurveQuote(p,launch,node,block):Promise.resolve(undefined),verifyTradeCode(p,launch.phase===2,block)]);
    let q={output:BigNumber.from(0),minimum:BigNumber.from(0),spent:BigNumber.from(0),refund:BigNumber.from(0)};
    let gas=BigNumber.from(0),settled=false;
    const feeFields={type:2,maxFeePerGas:feeData.fee,maxPriorityFeePerGas:feeData.tip};
    for(let attempt=0;attempt<GAS_REFINEMENT_LIMIT;attempt++){
      if(side==='buy'){
        if(balance.lte(reserve))throw new Error(exitGasUnits?'This node needs more Robinhood ETH for Max Buy to reserve gas for approvals and a sell. Fund the node or choose a smaller buy.':'This node needs more Robinhood ETH for trading and gas.');
        if(percent!==null)input=percentageAmount(balance.sub(reserve),percent);value=input;
      }
      if(input.lte(0))throw new Error('This node has too little balance for the selected percentage.');
      if(!isApproval){
        q=await quote(p,launch,node,side,input,block,curveState);
        if(q.minimum.lte(0))throw new Error('Trade is too small for slippage protection.');
        data=launch.phase===0?curveInterface.encodeFunctionData(side,[input,q.minimum,node]):encodeV4Trade(launch,side,input,q.minimum,deadline,node);
      }
      const tx={to,data,value:value.toString(),from:node};
      if(side==='buy'){
        // Exploratory only: zero gas price avoids the estimator charging its default
        // fee against a value that has not yet had actual gas deducted. It is never
        // retained or signed. The final request below uses the reviewed EIP-1559 fees.
        const probeGas=paddedGas(await p.estimateGas({...tx,gasPrice:0}));
        const needed=probeGas.mul(feeData.fee).add(futureGasReserve(probeGas));
        if(needed.gt(reserve)){reserve=needed;if(percent!==null)continue;}
      }
      const finalTx={...tx,...feeFields};
      gas=paddedGas(await p.estimateGas(finalTx));
      const needed=gas.mul(feeData.fee).add(futureGasReserve(gas));
      if(side==='buy'&&needed.gt(reserve)){reserve=needed;if(percent!==null)continue;}
      const followingBuffer=followingGasReserve(gas);
      if(side==='sell')reserve=action==='sell'?gas.mul(feeData.fee):needed;
      assertAffordable(balance,value.add(gas.mul(feeData.fee)),followingBuffer);
      // Pin simulation to the affordable reviewed gas limit. RPC defaults can
      // otherwise charge a block-sized gas limit and reject a funded wallet.
      const simulation=await p.call({...finalTx,gasLimit:gas},'pending');
      if(action==='approve-token' && tokenInterface.decodeFunctionResult('approve',simulation)[0]!==true)throw new Error('The token refused the exact approval.');
      settled=true;break;
    }
    if(!settled)throw new Error('Trade gas did not stabilize within the quote bound. Get a fresh quote.');
    const maxGas=gas.mul(feeData.fee),total=value.add(maxGas);
    // Future steps require new estimates and separate explicit confirmations.
    // These retained floor buffers are not quotes or guarantees of future gas.
    const futureReserve=followingGasReserve(gas);
    assertAffordable(balance,total,futureReserve);
    assertActive();available(node);await assertTradeChain(p);
    if(Date.now()>=expiresAt)throw new Error('The trade review expired during preparation. Get a fresh quote.');
    const review:NodeTradeReview=Object.freeze({nodeAddress:node,nodeIndex:index,tokenAddress:token,symbol,decimals,phase:launch.phase as 0|2,side,percent,...(customAmount!==undefined?{customAmount}:{}),action,
      route:launch.phase===0?'PONS curve':'Uniswap v4',amountInRaw:input.toString(),expectedOutputRaw:q.output.toString(),minimumOutputRaw:q.minimum.toString(),minimumIsRateBound:!isApproval&&side==='buy'&&launch.phase===0,
      expectedSpendWei:q.spent.toString(),expectedRefundWei:q.refund.toString(),ethBalanceWei:balance.toString(),tokenBalanceRaw:holding.toString(),maxGasCostWei:maxGas.toString(),maxTotalEthWei:total.toString(),
      gasReserveWei:reserve.toString(),requiredRemainingEthWei:futureReserve.toString(),balanceAfterMaxCostWei:balance.sub(total).toString(),gasLimit:gas.toString(),maxFeePerGasWei:feeData.fee.toString(),maxPriorityFeePerGasWei:feeData.tip.toString(),slippageBps:TRADE_SLIPPAGE_BPS,expiresAt,
      ...(approvalSpender?{approvalSpender}:{}),...(approvalExpiration?{approvalExpiresAt:approvalExpiration*1000}:{})});
    reviews.set(review,{owner,used:false,launch,minimum:q.minimum,approvalExpiration,tx:Object.freeze({to,data,value:value.toString(),chainId:4663,type:2,nonce:feeData.nonce,gasLimit:gas.toString(),maxFeePerGas:feeData.fee.toString(),maxPriorityFeePerGas:feeData.tip.toString()})});
    return review;
  }catch(e){if(e instanceof Error&&'code' in e&&e.code==='INSUFFICIENT_FUNDS')throw new Error('This node needs more Robinhood ETH for transaction gas. Fund the node, refresh balances, and prepare a new action.');if(e instanceof Error&&/node|trade|token|launch|pool|curve|network|gas|review|approval|contract|balance|percentage|storage|session|ETH/i.test(e.message))throw e;throw new Error('Could not safely prepare this trade. No transaction was signed.');}
  finally{p.removeAllListeners();}
}

// Retire an unsubmitted capability before a batch obtains its replacement.
// Sharing the signing lock prevents a concurrently executing original from
// escaping retirement and submitting alongside the renewed review.
export async function retireNodeTradeReview(owner:object,review:NodeTradeReview,assertActive:()=>void):Promise<void> {
  assertActive();
  if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Browser transaction locking is required for trading.');
  await navigator.locks.request(LOCK_PREFIX+review.nodeAddress.toLowerCase(),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is operating this node.');
    assertActive();available(review.nodeAddress);
    const cap=reviews.get(review);
    if(!cap||cap.owner!==owner||cap.used)throw new Error('This trade review is invalid or already used.');
    cap.used=true;
  });
}

export function assertNodeTradeReviewRoute(original:NodeTradeReview,fresh:NodeTradeReview):void {
  const before=reviews.get(original),after=reviews.get(fresh);
  if(!before||!after||before.owner!==after.owner||!sameLaunch(before.launch,after.launch))throw new Error('The launch route changed. Prepare a new explicit batch.');
}

export async function executeTrade(owner:object,review:NodeTradeReview,assertActive:()=>void,sign:(tx:providers.TransactionRequest)=>Promise<string>):Promise<NodeTradeOperation> {
  assertActive();const cap=reviews.get(review);if(!cap||cap.owner!==owner||cap.used)throw new Error('This trade review is invalid or already used.');
  if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Browser transaction locking is required for trading.');
  return navigator.locks.request(LOCK_PREFIX+review.nodeAddress.toLowerCase(),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is operating this node.');assertActive();available(review.nodeAddress);
    if(cap.used||Date.now()>=review.expiresAt)throw new Error('This trade review expired. Prepare a fresh trade.');
    const p=tradeProvider();
    try{
      const [,block]=await Promise.all([assertTradeChain(p),p.getBlockNumber()]);
      const [launch]=await Promise.all([readTradeLaunch(p,review.tokenAddress,block),verifyTradeCode(p,review.phase===2,block)]);assertLaunchTradable(launch);
      if(!sameLaunch(launch,cap.launch))throw new Error('The launch route changed. Prepare a fresh trade.');
      const t=new Contract(review.tokenAddress,TRADE_TOKEN_ABI,p);
      const isSwap=review.action==='buy'||review.action==='sell',isSell=isSwap&&review.side==='sell';
      const [balance,holding,feeData,estimate,simulation,q,allowance,permitAllowance]=await Promise.all([p.getBalance(review.nodeAddress,'pending'),t.balanceOf(review.nodeAddress,{blockTag:block}),
        feesAndNonce(p,review.nodeAddress),p.estimateGas({...cap.tx,from:review.nodeAddress}),p.call({...cap.tx,from:review.nodeAddress},'pending'),
        isSwap?quote(p,launch,review.nodeAddress,review.side,BigNumber.from(review.amountInRaw),block):Promise.resolve(null),
        isSell?t.allowance(review.nodeAddress,review.phase===0?launch.curve:TRADE_PERMIT2,{blockTag:block}):Promise.resolve(null),
        isSell&&review.phase===2?new Contract(TRADE_PERMIT2,TRADE_PERMIT_ABI,p).allowance(review.nodeAddress,review.tokenAddress,TRADE_ROUTER,{blockTag:block}):Promise.resolve(null),
      ]);
      assertAffordable(balance,BigNumber.from(review.maxTotalEthWei),BigNumber.from(review.requiredRemainingEthWei));
      if(feeData.nonce!==cap.tx.nonce)throw new Error('This node\'s transaction nonce changed. Refresh status and prepare a fresh trade.');
      // The new recommendation is not the cost of this immutable reviewed transaction.
      // Require the current base fee and the full original priority fee to fit its cap.
      if(feeData.baseFee.add(review.maxPriorityFeePerGasWei).gt(review.maxFeePerGasWei))throw new Error('The current base fee plus the reviewed priority fee exceeds this trade\'s maximum fee. Prepare a fresh trade.');
      if(estimate.gt(review.gasLimit))throw new Error('The new gas estimate exceeds this trade\'s reviewed gas limit. Prepare a fresh trade.');
      if(review.side==='sell'&&holding.lt(review.amountInRaw))throw new Error('This node\'s token balance is below the reviewed amount. Refresh balances and prepare a fresh trade.');
      if(review.action==='approve-token'&&tokenInterface.decodeFunctionResult('approve',simulation)[0]!==true)throw new Error('The token refused the approval.');
      if(isSwap&&q){
        const belowMinimum=review.side==='buy'&&review.phase===0 ? q.output.mul(review.amountInRaw).lt(q.spent.mul(cap.minimum)) : q.output.lt(cap.minimum);
        if(belowMinimum)throw new Error('The trade price changed beyond its reviewed tolerance. Get a fresh quote.');
        if(review.side==='sell'){
          if(!allowance||allowance.lt(review.amountInRaw))throw new Error('Token allowance changed. Prepare a fresh sell.');
          if(review.phase===2){
            if(!permitAllowance||BigNumber.from(permitAllowance.amount).lt(review.amountInRaw)||Number(permitAllowance.expiration)<Math.floor(review.expiresAt/1000)+30)throw new Error('Router allowance expired. Prepare a fresh sell.');}
        }
      }
      await assertTradeChain(p);assertActive();available(review.nodeAddress);
      if(Date.now()>=review.expiresAt)throw new Error('The trade review expired. Get a fresh quote.');cap.used=true;
      const raw=await sign(cap.tx);assertActive();if(Date.now()>=review.expiresAt)throw new Error('The review expired before submission.');
      const tx=utils.parseTransaction(raw);
      if(tx.chainId!==4663||tx.type!==2||tx.from!==review.nodeAddress||tx.to?.toLowerCase()!==String(cap.tx.to).toLowerCase()||tx.data!==cap.tx.data||tx.nonce!==cap.tx.nonce||
        !tx.value.eq(String(cap.tx.value))||!tx.gasLimit.eq(review.gasLimit)||!tx.maxFeePerGas?.eq(review.maxFeePerGasWei)||!tx.maxPriorityFeePerGas?.eq(review.maxPriorityFeePerGasWei)||tx.accessList?.length)throw new Error('The signed trade does not match its review.');
      const r:TradeRecord={version:1,nodeAddress:review.nodeAddress,tokenAddress:review.tokenAddress,action:review.action,side:review.side,txHash:utils.keccak256(raw),status:'pending',
        message:'Transaction submitted or awaiting confirmation. Check status before another action.',createdAt:Date.now(),to:String(cap.tx.to),data:String(cap.tx.data),value:String(cap.tx.value),nonce:tx.nonce,
        phase:review.phase,curve:cap.launch.curve,amountInRaw:review.amountInRaw,minimumOutputRaw:review.minimumOutputRaw,...(review.approvalSpender?{approvalSpender:review.approvalSpender}:{}),...(cap.approvalExpiration?{approvalExpiration:cap.approvalExpiration}:{})};
      save(r);
      try{const result=await p.send('eth_sendRawTransaction',[raw]);if(typeof result!=='string'||result.toLowerCase()!==r.txHash)throw Error();}
      catch{r.status='unknown';r.message='Transaction outcome is uncertain. Check its recorded hash; do not send again.';save(r);}
      return publicRecord(r);
    }finally{p.removeAllListeners();}
  });
}

function matchingEvent(receipt:providers.TransactionReceipt,contract:string,abi:utils.Interface,predicate:(event:utils.LogDescription)=>boolean):boolean {
  return receipt.logs.some(log=>{try{return log.address.toLowerCase()===contract.toLowerCase()&&predicate(abi.parseLog(log));}catch{return false;}});
}
export async function refreshNodeTradeOperation(node:string):Promise<NodeTradeOperation> {
  node=tradeAddress(node);const initial=read(node);if(!initial)throw new Error('No recorded trade exists for this node.');
  if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Browser transaction locking is required.');
  return navigator.locks.request(LOCK_PREFIX+node.toLowerCase(),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is operating this node.');const r=read(node);if(!r||r.txHash!==initial.txHash)throw new Error('The recorded trade changed. Reload status.');
    const p=tradeProvider();
    try{
      await assertTradeChain(p);const [receipt,tx]=await Promise.all([p.getTransactionReceipt(r.txHash),p.getTransaction(r.txHash)]);
      if(!receipt||!tx||receipt.confirmations<2){r.status='pending';r.message='Waiting for two Robinhood confirmations. Do not resubmit.';}
      else{
        if(tx.hash.toLowerCase()!==r.txHash||receipt.transactionHash.toLowerCase()!==r.txHash||tx.chainId!==4663||tx.from!==node||receipt.from!==node||
          tx.to?.toLowerCase()!==r.to.toLowerCase()||receipt.to?.toLowerCase()!==r.to.toLowerCase()||tx.nonce!==r.nonce||tx.data!==r.data||!tx.value.eq(r.value))throw Error();
        if(receipt.status===0){r.status='failed';r.message='Transaction reverted on Robinhood Chain. Funds were not traded; gas was spent. Prepare a new review if you want to retry.';}
        else if(receipt.status===1){
          let verified=false;
          if(r.action==='approve-token')verified=matchingEvent(receipt,r.tokenAddress,tokenInterface,e=>e.name==='Approval'&&e.args.owner===node&&e.args.spender.toLowerCase()===r.approvalSpender?.toLowerCase()&&e.args.value.eq(r.amountInRaw));
          else if(r.action==='approve-router')verified=matchingEvent(receipt,TRADE_PERMIT2,permitInterface,e=>e.name==='Approval'&&e.args.owner===node&&e.args.token.toLowerCase()===r.tokenAddress.toLowerCase()&&e.args.spender.toLowerCase()===TRADE_ROUTER.toLowerCase()&&e.args.amount.eq(r.amountInRaw)&&Number(e.args.expiration)===r.approvalExpiration);
          else if(r.phase===0)verified=matchingEvent(receipt,r.curve,curveInterface,e=>{
            if(e.args.recipient!==node)return false;
            if(r.action==='buy')return e.name==='CurveBuy'&&e.args.buyer===node&&e.args.quoteIn.gt(0)&&e.args.quoteIn.lte(r.amountInRaw)&&e.args.tokensOut.gt(0)&&
              e.args.tokensOut.mul(r.amountInRaw).gte(e.args.quoteIn.mul(r.minimumOutputRaw));
            return e.name==='CurveSell'&&e.args.seller===node&&e.args.tokensIn.eq(r.amountInRaw)&&e.args.quoteOut.gte(r.minimumOutputRaw);
          });
          else{
            await verifyTradeCode(p,true,receipt.blockNumber);
            // Router exact calldata+success guarantees TAKE_ALL minimum to msg.sender.
            // Additionally require the launch-token transfer in the same receipt.
            verified=matchingEvent(receipt,r.tokenAddress,tokenInterface,e=>e.name==='Transfer'&&(r.action==='buy'?
              e.args.to===node&&e.args.value.gte(r.minimumOutputRaw):e.args.from===node&&e.args.to.toLowerCase()===TRADE_POOL_MANAGER.toLowerCase()&&e.args.value.eq(r.amountInRaw)));
          }
          if(!verified)throw Error();r.status='confirmed';r.message=(r.action==='approve-token'||r.action==='approve-router')?'Approval confirmed. Prepare a fresh sell quote; no sale has been sent.':'Trade confirmed on Robinhood Chain. Refresh holdings for the latest balances.';
        }else throw Error();
      }
      await assertTradeChain(p);
    }catch{r.status='unknown';r.message='Could not conclusively verify this transaction. Preserve its hash and check again; do not resend.';}
    finally{p.removeAllListeners();}
    save(r);return publicRecord(r);
  });
}
