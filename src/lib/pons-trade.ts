import { BigNumber, Contract, providers, utils } from 'ethers';

export const TRADE_CHAIN_ID = 4663;
export const TRADE_SLIPPAGE_BPS = 200 as const;
export const TRADE_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const TRADE_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const TRADE_HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';
export const TRADE_ROUTER = '0x8876789976decbfcbbbe364623c63652db8c0904';
export const TRADE_QUOTER = '0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
export const TRADE_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
export const TRADE_PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
export const ZERO = '0x0000000000000000000000000000000000000000';
export const POOL_KEY = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
export const TRADE_FACTORY_ABI = [
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
  'function memeHook() view returns (address)',
];
export const TRADE_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)','function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)','function symbol() view returns (string)',
  'function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
];
export const TRADE_CURVE_ABI = [
  'function token() view returns (address)','function pairToken() view returns (address)','function isNativeQuote() view returns (bool)',
  'function getReserves() view returns (uint256 quoteReserve,uint256 tokenReserve)',
  'function sellableTokens() view returns (uint256)','function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)','function currentSnipeTaxBps(address) view returns (uint256)',
  'function readyToGraduate() view returns (bool)','function graduated() view returns (bool)',
  'function buy(uint256,uint256,address) payable returns (uint256)','function sell(uint256,uint256,address) returns (uint256)',
  'event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax)',
  'event CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 tax)',
];
export const TRADE_PERMIT_ABI = [
  'function allowance(address,address,address) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  'function approve(address token,address spender,uint160 amount,uint48 expiration)',
  'event Approval(address indexed owner,address indexed token,address indexed spender,uint160 amount,uint48 expiration)',
];
export const TRADE_UNIVERSAL_ABI = ['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'];
export const TRADE_QUOTER_ABI = [`function quoteExactInputSingle((${POOL_KEY} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`];
// Exact runtime hashes from Sourcify verified onchain bytecode, checked again on canonical RPC.
const CODE_HASHES: readonly (readonly [string,string])[] = [
  [TRADE_FACTORY,'0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84'],
  [TRADE_HOOK,'0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db'],
  [TRADE_ROUTER,'0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde'],
  [TRADE_QUOTER,'0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6'],
  [TRADE_POOL_MANAGER,'0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626'],
  [TRADE_PERMIT2,'0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca'],
];
export type NodeTradePercent = 5 | 10 | 25 | 50 | 100;
export type NodeTradeAmount = NodeTradePercent | { readonly amount: string };
// Copy caller-owned input before any asynchronous work, preserving the clicked text.
export function copyTradeAmount(selection:NodeTradeAmount):NodeTradeAmount {
  if(typeof selection==='number'){percentageAmount(BigNumber.from(1),selection);return selection;}
  const amount=selection&&typeof selection==='object'?selection.amount:undefined;
  if(typeof amount!=='string'||amount.length>116||! /^(0|[1-9]\d*)(\.\d+)?$/.test(amount)||!/[1-9]/.test(amount))throw new Error('Enter a positive decimal trade amount, without spaces or exponent notation.');
  return Object.freeze({amount});
}
export function parseTradeAmount(amount:string,decimals:number):BigNumber {
  copyTradeAmount({amount});
  if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Token decimals are invalid.');
  if((amount.split('.')[1]||'').length>decimals)throw new Error(`Trade amount has more than ${decimals} decimal places.`);
  const raw=utils.parseUnits(amount,decimals);
  if(raw.lte(0)||raw.gt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'))throw new Error('Trade amount exceeds the supported token amount bound.');
  return raw;
}
export type NodeTradeSide = 'buy' | 'sell';
export interface NodeTradingBalance {
  readonly nodeAddress: string; readonly ethBalanceWei: string; readonly tokenBalanceRaw: string; readonly supplySharePercent: string;
}
export interface NodeTradingSnapshot {
  readonly tokenAddress: string; readonly symbol: string; readonly decimals: number; readonly totalSupplyRaw: string;
  readonly curveAddress: string; readonly phase: 0 | 1 | 2 | 3; readonly tradingAvailable: boolean; readonly phaseMessage: string;
  readonly chainId: 4663; readonly blockNumber: number; readonly checkedAt: number; readonly balances: readonly NodeTradingBalance[];
}
export interface TradeLaunch { token: string; curve: string; phase: 0|1|2|3; poolFee: number; tickSpacing: number; ready: boolean; }
export const tradeAddress = (value: string): string => {
  if(typeof value!=='string' || !/^0x[\da-fA-F]{40}$/.test(value) || value.toLowerCase()===ZERO)throw new Error('Enter a valid nonzero token or node address.');
  return utils.getAddress(value);
};
export function tradeProvider(): providers.JsonRpcProvider {
  // This URL is fixed, unlike the connected browser wallet. Keep the explicit
  // eth_chainId guards around each operation without re-detecting every read.
  return new providers.StaticJsonRpcProvider({url:TRADE_RPC,timeout:15000},{chainId:TRADE_CHAIN_ID,name:'robinhood'});
}
export async function assertTradeChain(p: providers.JsonRpcProvider): Promise<void> {
  if(BigNumber.from(await p.send('eth_chainId',[])).toNumber()!==TRADE_CHAIN_ID)throw new Error('Trading RPC returned the wrong network.');
}
export async function verifyTradeCode(p: providers.JsonRpcProvider,v4:boolean,blockTag?:number):Promise<void> {
  const anchors=v4?CODE_HASHES:CODE_HASHES.slice(0,1);
  const codes=await Promise.all(anchors.map(([a])=>p.getCode(a,blockTag)));
  if(codes.some((code,i)=>utils.keccak256(code)!==anchors[i][1]))throw new Error('A trusted trading contract has changed or is unavailable.');
}
export async function readTradeLaunch(p:providers.JsonRpcProvider,token:string,block:number):Promise<TradeLaunch> {
  token=tradeAddress(token);const f=new Contract(TRADE_FACTORY,TRADE_FACTORY_ABI,p);
  const r=await f.getLaunchedToken(token,{blockTag:block});
  if(r.exists!==true || tradeAddress(r.token)!==token || String(r.pairToken).toLowerCase()!==ZERO || ![0,1,2,3].includes(r.phase))throw new Error('This is not a native ETH launch from the configured PONS factory.');
  const curve=tradeAddress(r.curve);
  const c=new Contract(curve,TRADE_CURVE_ABI,p);
  const [curveToken,pair,native,ready,graduated,tokenCode,curveCode]=await Promise.all([
    c.token({blockTag:block}),c.pairToken({blockTag:block}),c.isNativeQuote({blockTag:block}),c.readyToGraduate({blockTag:block}),c.graduated({blockTag:block}),p.getCode(token,block),p.getCode(curve,block),
  ]);
  if(tradeAddress(curveToken)!==token || String(pair).toLowerCase()!==ZERO || native!==true || tokenCode==='0x' || curveCode==='0x' || (r.phase===0 && graduated))throw new Error('PONS token and curve state did not match.');
  if(r.phase===2){
    const hook=await f.memeHook({blockTag:block});
    if(String(hook).toLowerCase()!==TRADE_HOOK.toLowerCase() || r.poolFee!==0 || !Number.isInteger(r.tickSpacing) || r.tickSpacing<=0 || r.tickSpacing>32767)throw new Error('The graduated PONS pool configuration is unsupported.');
  }
  return {token,curve,phase:r.phase,poolFee:r.poolFee,tickSpacing:r.tickSpacing,ready};
}
export function assertLaunchTradable(launch:TradeLaunch):void {
  if(launch.phase===1 || (launch.phase===0 && launch.ready))throw new Error('This launch is migrating to its pool. Trading is temporarily unavailable.');
  if(launch.phase===3)throw new Error('This launch was rescued and trading is unavailable.');
}
export function percentageAmount(balance:BigNumber,percent:NodeTradePercent):BigNumber {
  if(![5,10,25,50,100].includes(percent))throw new Error('Choose 5%, 10%, 25%, 50% or Max.');
  return balance.mul(percent).div(100);
}
export function supplyShare(balance:BigNumber,supply:BigNumber):string {
  if(supply.lte(0) || balance.lt(0) || balance.gt(supply))throw new Error('Invalid token supply or holdings.');
  const scaled=balance.mul(100000000).div(supply).toString().padStart(7,'0');
  return scaled.slice(0,-6)+'.'+scaled.slice(-6);
}
export interface CurveQuoteState {quoteReserve:BigNumber;tokenReserve:BigNumber;sellable:BigNumber;feeBps:BigNumber;creatorTaxBps:BigNumber;snipeBps:BigNumber;}
function validateCurveState(s:CurveQuoteState):void {
  if(s.quoteReserve.lte(0)||s.tokenReserve.lte(0)||s.sellable.lt(0)||s.sellable.gte(s.tokenReserve)||s.feeBps.lt(0)||s.creatorTaxBps.lt(0)||s.snipeBps.lt(0)||s.feeBps.add(s.creatorTaxBps).gt(9900))throw new Error('Invalid curve pricing state.');
}
export function quoteCurveBuy(s:CurveQuoteState,input:BigNumber):{output:BigNumber;spent:BigNumber;refund:BigNumber;minimumRateOutput:BigNumber} {
  validateCurveState(s);if(input.lte(0)||s.sellable.isZero())throw new Error('No curve tokens are available.');
  const maxSnipe=BigNumber.from(9900).sub(s.feeBps).sub(s.creatorTaxBps),snipe=s.snipeBps.gt(maxSnipe)?maxSnipe:s.snipeBps;
  const net=input.sub(input.mul(s.feeBps).div(10000)).sub(input.mul(s.creatorTaxBps).div(10000)).sub(input.mul(snipe).div(10000));
  let output=net.mul(s.tokenReserve).div(s.quoteReserve.add(net)),spent=input;
  if(output.gt(s.sellable)){
    output=s.sellable;const netEdge=output.mul(s.quoteReserve).div(s.tokenReserve.sub(output)).add(1);
    const divisor=BigNumber.from(10000).sub(s.feeBps).sub(s.creatorTaxBps).sub(snipe);
    const gross=netEdge.mul(10000).add(divisor).sub(1).div(divisor);spent=gross.lt(input)?gross:input;
  }
  if(output.isZero()||spent.isZero())throw new Error('This trade is too small.');
  // Curve checks spent*minTokensOut <= sent*tokensOut, so a clamped quote binds its price.
  const minimumRateOutput=output.mul(input).mul(10000-TRADE_SLIPPAGE_BPS).div(spent.mul(10000));
  if(minimumRateOutput.isZero())throw new Error('This trade is too small for slippage protection.');
  return {output,spent,refund:input.sub(spent),minimumRateOutput};
}
export function quoteCurveSell(s:CurveQuoteState,input:BigNumber):BigNumber {
  validateCurveState(s);if(input.lte(0))throw new Error('Enter a positive token amount.');
  const gross=input.mul(s.quoteReserve).div(s.tokenReserve.add(input));
  const output=gross.sub(gross.mul(s.feeBps).div(10000)).sub(gross.mul(s.creatorTaxBps).div(10000));
  if(output.isZero())throw new Error('This sale is too small.');return output;
}
export async function readCurveQuote(p:providers.JsonRpcProvider,launch:TradeLaunch,node:string,block:number):Promise<CurveQuoteState> {
  const c=new Contract(launch.curve,TRADE_CURVE_ABI,p),b={blockTag:block};
  const [reserves,sellable,feeBps,creatorTaxBps,snipeBps]=await Promise.all([c.getReserves(b),c.sellableTokens(b),c.feeBps(b),c.creatorTaxBps(b),c.currentSnipeTaxBps(node,b)]);
  return {quoteReserve:reserves[0],tokenReserve:reserves[1],sellable,feeBps,creatorTaxBps,snipeBps};
}
export function poolKey(launch:TradeLaunch):unknown[] {return [ZERO,launch.token,launch.poolFee,launch.tickSpacing,TRADE_HOOK];}
export function encodeV4Trade(launch:TradeLaunch,side:NodeTradeSide,input:BigNumber,minimum:BigNumber,deadline:number,node:string):string {
  if(input.gt('0xffffffffffffffffffffffffffffffff') || minimum.gt('0xffffffffffffffffffffffffffffffff'))throw new Error('Trade amount exceeds router bounds.');
  const coder=utils.defaultAbiCoder;
  // Verified deployed IV4Router includes minHopPriceX36; zero disables only that redundant per-hop bound.
  const swap=coder.encode([`(${POOL_KEY} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`],[[poolKey(launch),side==='buy',input,minimum,0,'0x']]);
  const settle=coder.encode(['address','uint256'],[side==='buy'?ZERO:launch.token,input]);
  const take=coder.encode(['address','uint256'],[side==='buy'?launch.token:ZERO,minimum]);
  const actions=coder.encode(['bytes','bytes[]'],['0x060c0f',[swap,settle,take]]);
  const commands=side==='buy'?'0x1004':'0x10';
  const inputs=side==='buy'?[actions,coder.encode(['address','address','uint256'],[ZERO,tradeAddress(node),0])]:[actions];
  return new utils.Interface(TRADE_UNIVERSAL_ABI).encodeFunctionData('execute',[commands,inputs,deadline]);
}
export async function getNodeTradingSnapshot(token:string,nodes:readonly string[]):Promise<NodeTradingSnapshot> {
  token=tradeAddress(token);if(!Array.isArray(nodes)||nodes.length<1||nodes.length>50)throw new Error('Choose between 1 and 50 node wallets.');
  const addresses=nodes.map(tradeAddress);if(new Set(addresses).size!==addresses.length)throw new Error('Duplicate node addresses.');
  const p=tradeProvider();
  try{
    await assertTradeChain(p);const block=await p.getBlockNumber();await verifyTradeCode(p,false,block);
    const launch=await readTradeLaunch(p,token,block),t=new Contract(token,TRADE_TOKEN_ABI,p),b={blockTag:block};
    const [symbol,decimals,total]=await Promise.all([t.symbol(b),t.decimals(b),t.totalSupply(b)]);
    if(typeof symbol!=='string'||symbol.length>64||!Number.isInteger(decimals)||decimals<0||decimals>36||total.lte(0))throw new Error('Token metadata could not be verified.');
    const balances:NodeTradingBalance[]=[];
    for(let i=0;i<addresses.length;i+=4){
      const rows=await Promise.all(addresses.slice(i,i+4).map(async node=>{
        const [eth,holding]=await Promise.all([p.getBalance(node,block),t.balanceOf(node,b)]);
        return Object.freeze({nodeAddress:node,ethBalanceWei:eth.toString(),tokenBalanceRaw:holding.toString(),supplySharePercent:supplyShare(holding,total)});
      }));balances.push(...rows);
    }
    await assertTradeChain(p);
    const available=launch.phase===2||(launch.phase===0&&!launch.ready);
    return Object.freeze({tokenAddress:token,symbol,decimals,totalSupplyRaw:total.toString(),curveAddress:launch.curve,phase:launch.phase,tradingAvailable:available,
      phaseMessage:available?(launch.phase===0?'Trading on the PONS curve.':'Trading on the graduated Uniswap v4 pool.'):
      launch.phase===3?'Rescued launch; trading unavailable.':'Migration in progress; wait for the pool.',chainId:4663,blockNumber:block,checkedAt:Date.now(),balances:Object.freeze(balances)});
  }catch(e){if(e instanceof Error && /launch|token|curve|network|contract|metadata|supply/i.test(e.message))throw e;throw new Error('Could not read node holdings on Robinhood Chain.');}
  finally{p.removeAllListeners();}
}
