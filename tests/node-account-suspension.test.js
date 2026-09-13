const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),ethers=require('ethers');
const bn=ethers.BigNumber.from,eth=ethers.utils.parseEther;
const phrase='test test test test test test test test test test test junk',wallet=ethers.Wallet.fromMnemonic(phrase);
const TOKEN=ethers.utils.getAddress('0x'+'11'.repeat(20)),CURVE=ethers.utils.getAddress('0x'+'22'.repeat(20));
const runtimes=require('./fixtures/pons-trade-runtime.json').contracts;
function harness(options={}){
 const mem=new Map(),calls=[],modules={},state={now:Date.now(),active:true,phase:options.phase??0,allowance:bn(options.allowance||0),permit:bn(options.permit||0),confirmed:false,failed:false,price:100,nonce:0};
 class Clock extends Date{static now(){return state.now;}}
 class FixtureWallet extends ethers.Wallet{static createRandom(){return ethers.Wallet.fromMnemonic(phrase);}async signTransaction(tx){const signed=await super.signTransaction(tx);if(state.invalidateOnSign)state.selectionActive=false;if(state.onSign)state.onSign();return signed;}}
 class Provider{
  constructor(connection){assert.equal(connection.url,'https://rpc.mainnet.chain.robinhood.com');}
  async send(method,args){calls.push(method);if(method==='eth_chainId')return options.wrongChain?'0x1':'0x1237';assert.equal(method,'eth_sendRawTransaction');assert.equal(mem.size,1);if(options.broadcastFail)throw Error('uncertain');return ethers.utils.keccak256(args[0]);}
  async getCode(address){calls.push(['code',address]);return options.wrongCode?'0x00':runtimes[address.toLowerCase()]||'0x1234';}
  async getBlockNumber(){return 100;}
  async getBalance(){if(options.traceBalance){state.balanceReads=(state.balanceReads||0)+1;state.balanceActive=(state.balanceActive||0)+1;state.balanceMax=Math.max(state.balanceMax||0,state.balanceActive);await new Promise(resolve=>setTimeout(resolve,0));state.balanceActive--;}return state.balanceOverride||eth(options.balance||(options.lowBalance?'0.000001':'1'));}
  async getFeeData(){return {maxFeePerGas:bn('2000000000'),maxPriorityFeePerGas:bn('1000000000')};}
  async getTransactionCount(){return state.nonce;}
  async estimateGas(tx){calls.push(['estimate',tx]);if(state.onEstimate)await state.onEstimate();if(state.invalidateOnEstimate)state.selectionActive=false;return bn(options.estimate?options.estimate(tx,calls.filter(c=>Array.isArray(c)&&c[0]==='estimate').length):options.hugeGas?'4000000':'100000');}
  async call(tx){if(tx.maxFeePerGas!==undefined){assert.ok(tx.gasLimit,'fee-bearing calls require explicit affordable gas');assert.ok(bn(tx.value).add(bn(tx.gasLimit).mul(tx.maxFeePerGas)).lte(await this.getBalance()),'simulation must be affordable');}const abi=new ethers.utils.Interface(['function approve(address,uint256) returns (bool)']);if(tx.data.startsWith(abi.getSighash('approve')))return abi.encodeFunctionResult('approve',[!options.refuseApproval]);if(options.simulationFail)throw Error('simulation failed');return '0x';}
  async getTransactionReceipt(hash){
   if(!state.confirmed)return null;const r=JSON.parse([...mem.values()][0]),p=load('pons-trade');let logs=[];
   if(!options.missingEvent){
    if(r.action==='approve-token')logs=[event(p.TRADE_TOKEN_ABI,'Approval',[wallet.address,r.approvalSpender,r.amountInRaw],TOKEN)];
    else if(r.action==='approve-router')logs=[event(p.TRADE_PERMIT_ABI,'Approval',[wallet.address,TOKEN,p.TRADE_ROUTER,r.amountInRaw,r.approvalExpiration],p.TRADE_PERMIT2)];
    else if(r.phase===0)logs=[r.action==='buy'?event(p.TRADE_CURVE_ABI,'CurveBuy',[wallet.address,wallet.address,r.amountInRaw,bn(r.minimumOutputRaw).add(1),0,0],CURVE):event(p.TRADE_CURVE_ABI,'CurveSell',[wallet.address,wallet.address,r.amountInRaw,bn(r.minimumOutputRaw).add(1),0,0],CURVE)];
    else logs=[event(p.TRADE_TOKEN_ABI,'Transfer',r.action==='buy'?[p.TRADE_POOL_MANAGER,wallet.address,r.minimumOutputRaw]:[wallet.address,p.TRADE_POOL_MANAGER,r.amountInRaw],TOKEN)];
   }
   return {transactionHash:hash,from:wallet.address,to:r.to,status:state.failed?0:1,confirmations:3,blockNumber:102,logs};
  }
  async getTransaction(hash){const r=JSON.parse([...mem.values()][0]);return {hash,chainId:4663,from:wallet.address,to:r.to,nonce:r.nonce,data:r.data,value:bn(r.value)};}
  removeAllListeners(){}
 }
 function event(abi,name,args,address){const i=new ethers.utils.Interface(abi);return {address,...i.encodeEventLog(i.getEvent(name),args)};}
 class Contract{
  constructor(address){this.address=address;this.callStatic={quoteExactInputSingle:async args=>{calls.push(['v4quote',args]);return {amountOut:bn(args[2]).mul(state.price),gasEstimate:bn(100000)};}};}
  async getLaunchedToken(token){return {token:options.wrongToken?CURVE:token,curve:CURVE,pairToken:options.wrongPair?TOKEN:ethers.constants.AddressZero,exists:!options.notPons,phase:state.phase,poolFee:0,tickSpacing:200};}
  async memeHook(){return load('pons-trade').TRADE_HOOK;}
  async token(){return TOKEN;}async pairToken(){return ethers.constants.AddressZero;}async isNativeQuote(){return true;}async readyToGraduate(){return !!options.ready;}async graduated(){return state.phase!==0;}
  async balanceOf(){if(options.holding)return bn(options.holding);return options.hugeHolding?bn('0x100000000000000000000000000000000'):eth('100');}async symbol(){return 'TST';}async decimals(){return options.decimals??18;}async totalSupply(){return eth('1000000');}
  async allowance(...args){return args.length===4?{amount:state.permit,expiration:Math.floor(state.now/1000)+1000,nonce:0}:state.allowance;}
  async getReserves(block){calls.push(['curve-state',block]);return [eth('100'),state.curveTokenReserve||eth('1000000')];}async sellableTokens(){return options.sellable?bn(options.sellable):eth('900000');}async feeBps(){return bn(100);}async creatorTaxBps(){return bn(0);}async currentSnipeTaxBps(){return bn(0);}
 }
 const context={Date:Clock,Error,console,setTimeout,clearTimeout,window:{localStorage:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>{if(options.storageFail)throw Error();mem.set(k,v);}}},navigator:{locks:{request:async(name,opt,fn)=>fn(options.busy?null:{name})}}};
 function load(name){if(modules[name])return modules[name];const m={exports:{}};modules[name]=m.exports;const src=fs.readFileSync(path.join(__dirname,'../src/lib/'+name+'.ts'),'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext('(function(require,module,exports){'+js+'\n})',context)(id=>id==='ethers'?{...ethers,Wallet:options.fixedRoot?FixtureWallet:ethers.Wallet,Contract,providers:{JsonRpcProvider:Provider,StaticJsonRpcProvider:Provider}}:id.startsWith('./')?load(id.slice(2)):require(id),m,m.exports);return m.exports;
 }
 const h={state,mem,calls,p:load('pons-trade'),t:load('node-trading'),vault:()=>load('node-vault'),batch:()=>load('node-trade-batch'),assertActive:()=>{if(!state.active)throw Error('session forgotten');}};return h;
}

const IDENTITY='a'.repeat(64);
async function restored(h, ready=true){
 const v=h.vault();if(ready)v.setNodeAccountAccess?.(IDENTITY,true,true);
 const original=v.createNodeSession(1),backup=await v.encryptNodeBackup(original,'inert account pause fixture');
 const session=await v.restoreNodeBackup(backup,'inert account pause fixture');v.forgetNodeSession(original);
 return {v,session};
}
test('unverified account cannot call the financial vault preparation wrapper directly',async()=>{
 const h=harness({fixedRoot:true}),{v,session}=await restored(h,false);
 await assert.rejects(v.prepareNodeTrade(session,0,TOKEN,'buy',5),/account|verified|paused/i);
 assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
});
test('temporary account pause preserves the wallet and cancels an in-flight continuation even after recovery',async()=>{
 const h=harness({fixedRoot:true}),{v,session}=await restored(h);
 const review=await v.prepareNodeTrade(session,0,TOKEN,'buy',5);
 h.state.onEstimate=async()=>{v.setNodeAccountAccess?.(IDENTITY,true,false);assert.equal(v.isVerifiedNodeSession(session),true);v.setNodeAccountAccess?.(IDENTITY,true,true);};
 await assert.rejects(v.executeNodeTrade(session,review),/account|changed|paused/i);
 assert.equal(h.calls.includes('eth_sendRawTransaction'),false);assert.equal(h.mem.size,0);
});
test('pause during signing blocks persistence and broadcast even if readiness recovers immediately',async()=>{
 const h=harness({fixedRoot:true}),{v,session}=await restored(h);
 const review=await v.prepareNodeTrade(session,0,TOKEN,'buy',5);
 h.state.onSign=()=>{v.setNodeAccountAccess?.(IDENTITY,true,false);v.setNodeAccountAccess?.(IDENTITY,true,true);};
 await assert.rejects(v.executeNodeTrade(session,review),/account|changed|paused/i);
 assert.equal(h.calls.includes('eth_sendRawTransaction'),false);assert.equal(h.mem.size,0);
});
test('account pause invalidates a whole batch intent across recovery',async()=>{
 const h=harness({fixedRoot:true}),{v,session}=await restored(h),b=h.batch();
 const batch=await b.prepareNodeTradeBatch(session,TOKEN,'buy',()=>{});
 v.setNodeAccountAccess?.(IDENTITY,true,false);v.setNodeAccountAccess?.(IDENTITY,true,true);
 await assert.rejects(b.executeNodeTradeBatch(session,batch,()=>{}),/account|changed|paused/i);
 assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
});


test('same-owner recovery permits a fresh action but cannot reuse a prepared review',async()=>{
 const h=harness({fixedRoot:true}),{v,session}=await restored(h),old=await v.prepareNodeTrade(session,0,TOKEN,'buy',5);
 const before=v.getNodeFinancialEpoch(session);v.setNodeAccountAccess(IDENTITY,true,false);
 assert.equal(v.isVerifiedNodeSession(session),true);await assert.rejects(v.prepareNodeTrade(session,0,TOKEN,'buy',5),/paused/);
 v.setNodeAccountAccess(IDENTITY,true,true);assert.notEqual(v.getNodeFinancialEpoch(session),before);
 await assert.rejects(v.executeNodeTrade(session,old),/verification changed/);
 const fresh=await v.prepareNodeTrade(session,0,TOKEN,'buy',5);assert.equal((await v.executeNodeTrade(session,fresh)).status,'pending');
 assert.equal(h.calls.filter(c=>c==='eth_sendRawTransaction').length,1);
});
test('owner revocation and idle expiration cannot be revived by readiness recovery',async()=>{
 for(const kind of ['owner','revocation','idle']){
  const h=harness({fixedRoot:true}),{v,session}=await restored(h);v.setNodeAccountAccess(IDENTITY,true,false);
  if(kind==='owner')v.setNodeAccountAccess('b'.repeat(64),true,true);
  if(kind==='revocation')v.setNodeAccountAccess(null,false,false);
  if(kind==='idle')h.state.now+=v.NODE_IDLE_MS;
  v.setNodeAccountAccess(IDENTITY,true,true);assert.equal(v.isVerifiedNodeSession(session),false);
  await assert.rejects(v.prepareNodeTrade(session,0,TOKEN,'buy',5),/no longer available/);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});
test('unbound restored sessions cannot adopt a later verified account',async()=>{
 const h=harness({fixedRoot:true}),{v,session}=await restored(h,false);v.setNodeAccountAccess(IDENTITY,true,true);
 assert.equal(v.isVerifiedNodeSession(session),false);await assert.rejects(v.prepareNodeTrade(session,0,TOKEN,'buy',5),/no longer available/);
});
