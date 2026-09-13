const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),ethers=require('ethers');
const bn=ethers.BigNumber.from,eth=ethers.utils.parseEther;
const phrase='test test test test test test test test test test test junk',wallet=ethers.Wallet.fromMnemonic(phrase);
const TOKEN=ethers.utils.getAddress('0x'+'11'.repeat(20)),CURVE=ethers.utils.getAddress('0x'+'22'.repeat(20));
const runtimes=require('./fixtures/pons-trade-runtime.json').contracts;
function harness(options={}){
 const mem=new Map(),calls=[],modules={},state={now:Date.now(),active:true,phase:options.phase??0,allowance:bn(options.allowance||0),permit:bn(options.permit||0),confirmed:false,failed:false,price:100,nonce:0};
 class Clock extends Date{static now(){return state.now;}}
 class FixtureWallet extends ethers.Wallet{static createRandom(){return ethers.Wallet.fromMnemonic(phrase);}async signTransaction(tx){const signed=await super.signTransaction(tx);if(state.invalidateOnSign)state.selectionActive=false;return signed;}}
 class Provider{
  constructor(connection){assert.equal(connection.url,'https://rpc.mainnet.chain.robinhood.com');}
  async send(method,args){calls.push(method);if(method==='eth_chainId')return options.wrongChain?'0x1':'0x1237';assert.equal(method,'eth_sendRawTransaction');assert.equal(mem.size,1);if(options.broadcastFail)throw Error('uncertain');return ethers.utils.keccak256(args[0]);}
  async getCode(address){calls.push(['code',address]);return options.wrongCode?'0x00':runtimes[address.toLowerCase()]||'0x1234';}
  async getBlockNumber(){return 100;}
  async getBalance(){if(options.traceBalance){state.balanceReads=(state.balanceReads||0)+1;state.balanceActive=(state.balanceActive||0)+1;state.balanceMax=Math.max(state.balanceMax||0,state.balanceActive);await new Promise(resolve=>setTimeout(resolve,0));state.balanceActive--;}return state.balanceOverride||eth(options.balance||(options.lowBalance?'0.000001':'1'));}
  async getFeeData(){return {maxFeePerGas:bn('2000000000'),maxPriorityFeePerGas:bn('1000000000'),lastBaseFeePerGas:bn('500000000'),...state.feesOverride};}
  async getTransactionCount(){return state.nonce;}
  async estimateGas(tx){calls.push(['estimate',tx]);if(state.invalidateOnEstimate)state.selectionActive=false;return bn(options.estimate?options.estimate(tx,calls.filter(c=>Array.isArray(c)&&c[0]==='estimate').length):options.hugeGas?'4000000':'100000');}
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
 const h={state,mem,calls,p:load('pons-trade'),t:load('node-trading'),vault:()=>load('node-vault'),assertActive:()=>{if(!state.active)throw Error('session forgotten');}};return h;
}
const prepare=(h,side='buy',percent=5)=>h.t.prepareTrade(h,0,wallet.address,TOKEN,side,percent,h.assertActive);
const execute=(h,r)=>h.t.executeTrade(h,r,h.assertActive,tx=>wallet.signTransaction(tx));
for(const base of [undefined,null,'500000000',bn(-1)])test(`missing or invalid base fee ${String(base)} blocks preparation and execution`,async()=>{
 const h=harness(),r=await prepare(h,'sell',25);h.state.feesOverride={lastBaseFeePerGas:base};let signs=0;
 await assert.rejects(h.t.executeTrade(h,r,h.assertActive,async()=>{signs++;throw Error('unexpected signer');}),/base fee could not be safely verified/);
 await assert.rejects(prepare(h,'sell',25),/base fee could not be safely verified/);
 assert.equal(signs,0);assert.equal(h.mem.size,0);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
});
test('fresh recommendation and priority never replace the original signed fee fields',async()=>{
 const h=harness(),r=await prepare(h,'sell',25);
 h.state.feesOverride={maxFeePerGas:bn('2500000000'),maxPriorityFeePerGas:bn('1500000000')};
 let signed;
 await h.t.executeTrade(h,r,h.assertActive,async tx=>{signed=tx;return wallet.signTransaction(tx);});
 assert.equal(signed.maxFeePerGas,r.maxFeePerGasWei);assert.equal(signed.maxPriorityFeePerGas,r.maxPriorityFeePerGasWei);
 assert.equal(h.calls.filter(c=>c==='eth_sendRawTransaction').length,1);
});
test('curve integer math follows fees/input, fees/output and partial-fill price bound',()=>{
 const h=harness(),s={quoteReserve:bn(10000),tokenReserve:bn(100000),sellable:bn(90000),feeBps:bn(100),creatorTaxBps:bn(200),snipeBps:bn(0)};
 const buy=h.p.quoteCurveBuy(s,bn(1000));assert.equal(buy.output.toString(),'8842');assert.equal(buy.spent.toString(),'1000');
 const sell=h.p.quoteCurveSell(s,bn(1000));assert.equal(sell.toString(),'98');
 const edge=h.p.quoteCurveBuy({...s,sellable:bn(10)},bn(1000));assert.equal(edge.output.toString(),'10');assert.ok(edge.refund.gt(0));
 assert.ok(edge.minimumRateOutput.gt(edge.output));assert.ok(edge.output.mul(1000).gte(edge.spent.mul(edge.minimumRateOutput)));
 assert.throws(()=>h.p.quoteCurveBuy({...s,feeBps:bn(9901)},bn(1)));
 const taxed=h.p.quoteCurveBuy({...s,snipeBps:bn(9900)},bn(1000));assert.ok(taxed.output.lt(buy.output));
});
test('percentages and supply share retain exact integers beyond Number precision',()=>{
 const h=harness(),n=bn('900719925474099312345');assert.equal(h.p.percentageAmount(n,5).toString(),n.mul(5).div(100).toString());
 assert.equal(h.p.percentageAmount(n,100).toString(),n.toString());assert.throws(()=>h.p.percentageAmount(n,7));
 assert.equal(h.p.supplyShare(bn(1),bn(3)),'33.333333');assert.equal(h.p.supplyShare(bn(3),bn(3)),'100.000000');
});
test('native buy Max preserves conservative gas and signs exactly its immutable review once',async()=>{
 const h=harness(),r=await prepare(h,'buy',100);assert.ok(Object.isFrozen(r));assert.equal(r.amountInRaw,eth('0.99891').toString());assert.ok(bn(r.balanceAfterMaxCostWei).gte(eth('0.00005')));
 assert.equal(r.minimumIsRateBound,true);const op=await execute(h,r);assert.equal(op.status,'pending');await assert.rejects(execute(h,r));await assert.rejects(prepare(h));
 assert.equal(h.calls.filter(c=>c==='eth_sendRawTransaction').length,1);assert.ok([...h.mem.values()].every(s=>!s.includes(wallet.privateKey)));
 h.state.confirmed=true;assert.equal((await h.t.refreshNodeTradeOperation(wallet.address)).status,'confirmed');
});
test('curve sell requires exact separately confirmed approval and fresh explicit sell quote',async()=>{
 const h=harness(),r=await prepare(h,'sell',25);assert.equal(r.action,'approve-token');assert.equal(r.approvalSpender,CURVE);assert.equal(r.amountInRaw,eth('25').toString());
 await execute(h,r);h.state.confirmed=true;assert.equal((await h.t.refreshNodeTradeOperation(wallet.address)).status,'confirmed');assert.equal(h.calls.filter(c=>c==='eth_sendRawTransaction').length,1);
 h.state.allowance=bn(r.amountInRaw);const sale=await prepare(h,'sell',25);assert.equal(sale.action,'sell');await execute(h,sale);
});
test('phase2 requires exact token and router allowances with separate explicit confirmation and correct deployed calldata',async()=>{
 const h=harness({phase:2}),approval=await prepare(h,'sell',5);assert.equal(approval.action,'approve-token');assert.equal(approval.approvalSpender,h.p.TRADE_PERMIT2);
 await execute(h,approval);h.state.confirmed=true;await h.t.refreshNodeTradeOperation(wallet.address);h.state.allowance=bn(approval.amountInRaw);
 const permit=await prepare(h,'sell',5);assert.equal(permit.action,'approve-router');assert.equal(permit.approvalSpender,h.p.TRADE_ROUTER);assert.ok(permit.approvalExpiresAt>Date.now());
 await execute(h,permit);await h.t.refreshNodeTradeOperation(wallet.address);h.state.permit=bn(permit.amountInRaw);
 const sale=await prepare(h,'sell',5);assert.equal(sale.action,'sell');assert.equal(sale.route,'Uniswap v4');await execute(h,sale);assert.equal((await h.t.refreshNodeTradeOperation(wallet.address)).status,'confirmed');
});
test('v4 buy encoding fixes pool/native currencies, minHopPrice, own refund and output/debt caps',()=>{
 const h=harness({phase:2}),launch={token:TOKEN,curve:CURVE,phase:2,poolFee:0,tickSpacing:200,ready:false};
 const encoded=h.p.encodeV4Trade(launch,'buy',bn(100),bn(90),123,wallet.address);const i=new ethers.utils.Interface(h.p.TRADE_UNIVERSAL_ABI);const result=i.decodeFunctionData('execute',encoded);
 assert.equal(result.commands,'0x1004');assert.equal(result.inputs.length,2);const [actions,params]=ethers.utils.defaultAbiCoder.decode(['bytes','bytes[]'],result.inputs[0]);assert.equal(actions,'0x060c0f');
 const [swap]=ethers.utils.defaultAbiCoder.decode([`(${h.p.POOL_KEY},bool,uint128,uint128,uint256,bytes)`],params[0]);assert.equal(swap[0][0],ethers.constants.AddressZero);assert.equal(swap[0][1],TOKEN);assert.equal(swap[1],true);assert.equal(swap[2].toString(),'100');assert.equal(swap[3].toString(),'90');assert.equal(swap[4].toString(),'0');
 const sweep=ethers.utils.defaultAbiCoder.decode(['address','address','uint256'],result.inputs[1]);assert.equal(sweep[1],wallet.address);
});
test('wrong chain/factory/token/pair, changed phase, migration/rescued, gas and simulation fail before signing',async()=>{
 for(const options of [{wrongChain:true},{wrongCode:true},{wrongToken:true},{wrongPair:true},{notPons:true},{phase:1},{phase:3},{ready:true},{lowBalance:true},{hugeGas:true},{simulationFail:true}]){const h=harness(options);await assert.rejects(prepare(h));assert.equal(h.calls.includes('eth_sendRawTransaction'),false);}
 const h=harness(),r=await prepare(h);h.state.phase=2;await assert.rejects(execute(h,r));assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
});
test('forged, cross-owner, expired and forgotten reviews cannot sign',async()=>{
 for(const kind of ['forged','owner','expired','forgotten']){const h=harness(),r=await prepare(h);let signs=0;if(kind==='expired')h.state.now+=61000;if(kind==='forgotten')h.state.active=false;
 await assert.rejects(h.t.executeTrade(kind==='owner'?{}:h,kind==='forged'?{...r}:r,h.assertActive,async()=>{signs++;return '';}));assert.equal(signs,0);}
});
test('failed approval simulation and missing receipt evidence never auto-sell or claim confirmation',async()=>{
 const refused=harness({refuseApproval:true});await assert.rejects(prepare(refused,'sell'));assert.equal(refused.calls.includes('eth_sendRawTransaction'),false);
 const h=harness({missingEvent:true});await execute(h,await prepare(h));h.state.confirmed=true;assert.equal((await h.t.refreshNodeTradeOperation(wallet.address)).status,'unknown');await assert.rejects(prepare(h));
});
test('uncertain broadcast/storage/lock failures prevent duplicate sends and survive public recovery record',async()=>{
 const h=harness({broadcastFail:true});assert.equal((await execute(h,await prepare(h))).status,'unknown');assert.equal(h.t.getNodeTradeOperation(wallet.address).status,'unknown');await assert.rejects(prepare(h));
 for(const options of [{storageFail:true},{busy:true}]){const h=harness(options);await assert.rejects(execute(h,await prepare(h)));assert.equal(h.calls.includes('eth_sendRawTransaction'),false);}
});
test('verified revert permits only a new explicit reviewed attempt',async()=>{
 const h=harness();await execute(h,await prepare(h));h.state.confirmed=true;h.state.failed=true;assert.equal((await h.t.refreshNodeTradeOperation(wallet.address)).status,'failed');assert.ok(await prepare(h));assert.equal(h.calls.filter(c=>c==='eth_sendRawTransaction').length,1);
});
test('snapshots label migration and report same-block exact balances and supply holdings',async()=>{
 const h=harness({phase:1});const s=await h.p.getNodeTradingSnapshot(TOKEN,[wallet.address]);assert.equal(s.tradingAvailable,false);assert.equal(s.phase,1);assert.equal(s.balances[0].supplySharePercent,'0.010000');assert.equal(s.balances[0].ethBalanceWei,eth('1').toString());assert.ok(Object.isFrozen(s.balances));
});
test('narrow vault requires recovered session and does not expose a generic signer',async()=>{
 const h=harness({fixedRoot:true}),v=h.vault();v.setNodeAccountAccess('a'.repeat(64),true,true);const s=v.createNodeSession(1);await assert.rejects(v.prepareNodeTrade(s,0,TOKEN,'buy',5));
 const backup=await v.encryptNodeBackup(s,'disposable trade password'),restored=await v.restoreNodeBackup(backup,'disposable trade password');
 for(const stage of ['estimate','sign']){
  h.state.selectionActive=true;const review=await v.prepareNodeTrade(restored,0,TOKEN,'buy',5);
  h.state.invalidateOnEstimate=stage==='estimate';h.state.invalidateOnSign=stage==='sign';
  await assert.rejects(v.executeNodeTrade(restored,review,()=>{if(!h.state.selectionActive)throw Error('batch selection changed');}),/batch selection changed/);
  assert.equal(h.mem.size,0);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
  h.state.invalidateOnEstimate=false;h.state.invalidateOnSign=false;
 }
 const mutableAmount={amount:'0.001'};const customPending=v.prepareNodeTrade(restored,0,TOKEN,'buy',mutableAmount);mutableAmount.amount='0.9';const copied=await customPending;assert.equal(copied.amountInRaw,eth('0.001').toString());assert.equal(copied.customAmount,'0.001');
 const r=await v.prepareNodeTrade(restored,0,TOKEN,'buy',5);assert.equal((await v.executeNodeTrade(restored,r)).nodeAddress,restored.addresses[0]);
 v.forgetNodeSession(restored);await assert.rejects(v.executeNodeTrade(restored,r));assert.equal(Object.keys(v).some(k=>/private|signer/i.test(k)),false);v.forgetNodeSession(s);
});

test('execution rechecks the exact post-action gas reserve after balance drift for swaps and both approval routes',async()=>{
 for(const options of [{},{phase:0},{phase:2},{phase:2,allowance:eth('100').toString()}]){
 const h=harness(options),r=await prepare(h,options.phase===undefined?'buy':'sell',5);h.state.balanceOverride=bn(r.maxTotalEthWei).add(bn(r.requiredRemainingEthWei).sub(1));
 await assert.rejects(execute(h,r),/insufficient ETH.*reviewed cost and gas reserve/);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});

test('v4 oversized sell fails before granting any token allowance',async()=>{
 const h=harness({phase:2,hugeHolding:true});await assert.rejects(prepare(h,'sell',100),/v4 input bound/);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
});
test('expiry or forgotten session during signing cannot persist or broadcast',async()=>{
 for(const kind of ['expiry','forgotten']){const h=harness(),r=await prepare(h);
 await assert.rejects(h.t.executeTrade(h,r,h.assertActive,async tx=>{const signed=await wallet.signTransaction(tx);if(kind==='expiry')h.state.now+=61000;else h.state.active=false;return signed;}));
 assert.equal(h.mem.size,0);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});


test('funded nodes buy every preset using actual gas budget rather than the hard cap',async()=>{
 for(const phase of [0,2])for(const percent of [5,10,25,50,100]){
  const h=harness({phase,balance:'0.002984103299794045'}),r=await prepare(h,'buy',percent);
  assert.equal(r.gasLimit,'130000');const reserve=eth(percent===100?(phase===0?'0.00109':'0.00135'):'0.00031');assert.equal(r.gasReserveWei,reserve.toString());
  assert.equal(r.amountInRaw,eth('0.002984103299794045').sub(reserve).mul(percent).div(100).toString());
  assert.ok(bn(r.maxTotalEthWei).add(r.requiredRemainingEthWei).lte(r.ethBalanceWei));
  const estimates=h.calls.filter(c=>Array.isArray(c)&&c[0]==='estimate');
  assert.ok(estimates.some(c=>c[1].gasPrice===0));
  assert.ok(estimates.some(c=>c[1].maxFeePerGas!==undefined&&bn(c[1].value).eq(r.amountInRaw)));
  assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});
test('approved sells and approvals budget actual gas with explicitly limited future-step buffers',async()=>{
 for(const phase of [0,2]){
  const h=harness({phase,balance:'0.002984103299794045',allowance:eth('100'),permit:eth('100')}),r=await prepare(h,'sell',100);
  assert.equal(r.action,'sell');assert.equal(r.amountInRaw,eth('100').toString());assert.equal(r.requiredRemainingEthWei,eth('0.00005').toString());
  const approval=await prepare(harness({phase,balance:'0.002984103299794045'}),'sell',100);
  assert.equal(approval.action,'approve-token');assert.equal(approval.requiredRemainingEthWei,eth(phase===2?'0.0001':'0.00005').toString());
  assert.ok(bn(approval.maxTotalEthWei).add(approval.requiredRemainingEthWei).lte(approval.ethBalanceWei));
 }
});
test('buy gas refinement is monotonic when input-dependent estimates increase then decrease',async()=>{
 const h=harness({balance:'0.002984103299794045',estimate:(tx,n)=>n===1?100000:n===2?160000:120000}),r=await prepare(h,'buy',100);
 assert.equal(r.gasReserveWei,eth('0.001714').toString());assert.equal(r.gasLimit,'156000');
 assert.equal(r.amountInRaw,bn(r.ethBalanceWei).sub(r.gasReserveWei).toString());
 const values=h.calls.filter(c=>Array.isArray(c)&&c[0]==='estimate').map(c=>bn(c[1].value));
 assert.ok(values.every((v,i)=>i===0||v.lte(values[i-1])));
 assert.ok(bn(r.balanceAfterMaxCostWei).gte(r.requiredRemainingEthWei));
});
test('unaffordable, hard-cap and nonconverging gas reject without signing',async()=>{
 for(const options of [
  {balance:'0.0002'},
  {balance:'0.002984103299794045',estimate:()=>1500000},
  {estimate:()=>2307693},
  {estimate:(tx,n)=>100000+n*10000},
 ]){
  const h=harness(options);await assert.rejects(prepare(h,'buy',100),/gas|ETH/);
  assert.ok(h.calls.filter(c=>Array.isArray(c)&&c[0]==='estimate').length<=12);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});
test('fee-bearing final estimate can grow and is re-budgeted before producing a buy review',async()=>{
 const h=harness({balance:'0.002984103299794045',estimate:tx=>tx.maxFeePerGas===undefined?100000:160000}),r=await prepare(h,'buy',100);
 assert.equal(r.gasLimit,'208000');assert.equal(r.gasReserveWei,eth('0.001714').toString());
 assert.equal(r.amountInRaw,bn(r.ethBalanceWei).sub(r.gasReserveWei).toString());
 assert.ok(bn(r.maxTotalEthWei).add(r.requiredRemainingEthWei).eq(r.ethBalanceWei));
});


test('all quote routes encode the fixed 2 percent minimum with exact integer flooring',async()=>{
 for(const phase of [0,2])for(const side of ['buy','sell']){
  const h=harness({phase,allowance:eth('100'),permit:eth('100')}),r=await prepare(h,side,25);
  assert.equal(h.p.TRADE_SLIPPAGE_BPS,200);assert.equal(r.slippageBps,200);
  const expected=bn(r.expectedOutputRaw).mul(98).div(100);assert.equal(r.minimumOutputRaw,expected.toString());
  const tx=h.calls.find(c=>Array.isArray(c)&&c[0]==='estimate'&&c[1].maxFeePerGas!==undefined)[1];
  if(phase===0){const decoded=new ethers.utils.Interface(h.p.TRADE_CURVE_ABI).decodeFunctionData(side,tx.data);assert.equal(decoded[1].toString(),expected.toString());}
  else{
   const result=new ethers.utils.Interface(h.p.TRADE_UNIVERSAL_ABI).decodeFunctionData('execute',tx.data);
   const [,params]=ethers.utils.defaultAbiCoder.decode(['bytes','bytes[]'],result.inputs[0]);
   const [swap]=ethers.utils.defaultAbiCoder.decode([`(${h.p.POOL_KEY},bool,uint128,uint128,uint256,bytes)`],params[0]);
   const take=ethers.utils.defaultAbiCoder.decode(['address','uint256'],params[2]);
   assert.equal(swap[3].toString(),expected.toString());assert.equal(take[1].toString(),expected.toString());
  }
 }
});
test('clamped curve buy applies 98 percent to its normalized rate without changing floor order',()=>{
 const h=harness(),input=bn('1000003'),s={quoteReserve:bn(10000),tokenReserve:bn(100000),sellable:bn(173),feeBps:bn(100),creatorTaxBps:bn(200),snipeBps:bn(0)};
 const q=h.p.quoteCurveBuy(s,input);assert.ok(q.refund.gt(0));assert.equal(q.output.toString(),'173');
 assert.equal(q.minimumRateOutput.toString(),q.output.mul(input).mul(9800).div(q.spent.mul(10000)).toString());
 assert.ok(q.output.mul(input).gte(q.spent.mul(q.minimumRateOutput)));
});
test('every execution route accepts its rounded 2 percent boundary and rejects one unit below before signing',async()=>{
 for(const phase of [0,2])for(const side of ['buy','sell'])for(const below of [false,true]){
  const h=harness({phase,allowance:eth('100'),permit:eth('100')}),r=await prepare(h,side,25);let signs=0;
  if(phase===2){h.state.price=below?97:98;}
  else if(side==='sell'){h.p.quoteCurveSell=()=>bn(r.minimumOutputRaw).sub(below?1:0);}
  else{
   const original=h.p.quoteCurveBuy;h.p.quoteCurveBuy=(state,input)=>{const q=original(state,input),threshold=q.spent.mul(r.minimumOutputRaw).add(input.sub(1)).div(input);return {...q,output:threshold.sub(below?1:0)};};
  }
  await assert.rejects(h.t.executeTrade(h,r,h.assertActive,async()=>{signs++;throw Error('mock signer boundary reached');}),below?/price changed/:/mock signer boundary reached/);
  assert.equal(signs,below?0:1);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);assert.equal(h.mem.size,0);
 }
});


test('custom buys and sells preserve exact decimals through curve and v4 calldata',async()=>{
 for(const phase of [0,2])for(const side of ['buy','sell']){
  const decimals=side==='sell'?6:18,amount=side==='buy'?'0.001234567890123456':'12.345678',raw=ethers.utils.parseUnits(amount,side==='buy'?18:decimals);
  const h=harness({phase,decimals,holding:ethers.utils.parseUnits('100',decimals).toString(),allowance:ethers.constants.MaxUint256,permit:ethers.constants.MaxUint256}),r=await prepare(h,side,{amount});
  assert.equal(r.percent,null);assert.equal(r.customAmount,amount);assert.equal(r.amountInRaw,raw.toString());assert.equal(r.slippageBps,200);
  const tx=h.calls.find(c=>Array.isArray(c)&&c[0]==='estimate'&&c[1].maxFeePerGas!==undefined)[1];
  if(phase===0)assert.equal(new ethers.utils.Interface(h.p.TRADE_CURVE_ABI).decodeFunctionData(side,tx.data)[0].toString(),raw.toString());
  else{const decoded=new ethers.utils.Interface(h.p.TRADE_UNIVERSAL_ABI).decodeFunctionData('execute',tx.data),[,params]=ethers.utils.defaultAbiCoder.decode(['bytes','bytes[]'],decoded.inputs[0]),[swap]=ethers.utils.defaultAbiCoder.decode([`(${h.p.POOL_KEY},bool,uint128,uint128,uint256,bytes)`],params[0]);assert.equal(swap[2].toString(),raw.toString());}
  assert.equal(bn(tx.value).toString(),side==='buy'?raw.toString():'0');
  let signs=0;await assert.rejects(h.t.executeTrade(h,r,h.assertActive,async signedTx=>{signs++;assert.equal(signedTx.data,tx.data);assert.equal(bn(signedTx.value).toString(),side==='buy'?raw.toString():'0');throw Error('mock custom signer reached');}),/mock custom signer reached/);assert.equal(signs,1);assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});
test('custom sell approvals bind only the exact token amount and never auto-sell',async()=>{
 for(const options of [{phase:0},{phase:2},{phase:2,allowance:ethers.constants.MaxUint256}]){
  const h=harness({...options,decimals:6,holding:'100000000'}),r=await prepare(h,'sell',{amount:'12.345678'});
  assert.equal(r.amountInRaw,'12345678');assert.equal(r.percent,null);assert.ok(r.action.startsWith('approve'));assert.equal(r.customAmount,'12.345678');
  const tx=h.calls.find(c=>Array.isArray(c)&&c[0]==='estimate')[1];
  const decoded=new ethers.utils.Interface(r.action==='approve-token'?h.p.TRADE_TOKEN_ABI:h.p.TRADE_PERMIT_ABI).decodeFunctionData('approve',tx.data);
  assert.equal(decoded[r.action==='approve-token'?1:2].toString(),'12345678');assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});
test('invalid custom input, excess precision, overflow and insufficient balances never sign',async()=>{
 for(const amount of ['', '0', '-1', '+1', '1e-3', 'NaN', 'Infinity', ' 1', '1 ', '.1', '1.', '00.1', '1.0000000000000000001', '9'.repeat(79)]){
  const h=harness();await assert.rejects(prepare(h,'buy',{amount}));assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
 for(const [side,amount,options] of [['buy','0.003',{balance:'0.0031'}],['buy','2',{}],['sell','101',{}],['sell','1.0000001',{decimals:6}],['buy','340282366920938463463.374607431768211456',{phase:2,balance:'9999999999999999999999'}]]){
  const h=harness(options);await assert.rejects(prepare(h,side,{amount}));assert.equal(h.calls.includes('eth_sendRawTransaction'),false);
 }
});
test('custom amount is copied before awaiting and gas refinement never shrinks it',async()=>{
 const h=harness({balance:'0.003',estimate:(tx,n)=>n===1?100000:160000}),selection={amount:'0.001234'};
 const pending=prepare(h,'buy',selection);selection.amount='0.002';const r=await pending;
 assert.equal(r.customAmount,'0.001234');assert.equal(r.amountInRaw,eth('0.001234').toString());
 const values=h.calls.filter(c=>Array.isArray(c)&&c[0]==='estimate').map(c=>bn(c[1].value).toString());assert.ok(values.every(v=>v===r.amountInRaw));
});
test('curve state is read once per preparation and refreshed for execution; factory code is checked once',async()=>{
 const h=harness(),r=await prepare(h,'buy',100);
 assert.equal(h.calls.filter(c=>Array.isArray(c)&&c[0]==='curve-state').length,1);
 assert.equal(h.calls.filter(c=>Array.isArray(c)&&c[0]==='code'&&c[1]===h.p.TRADE_FACTORY).length,1);
 h.state.curveTokenReserve=eth('950000');let signs=0;
 await assert.rejects(h.t.executeTrade(h,r,h.assertActive,async()=>{signs++;return '';}),/price changed/);
 assert.equal(signs,0);assert.equal(h.calls.filter(c=>Array.isArray(c)&&c[0]==='curve-state').length,2);
 assert.ok(h.calls.filter(c=>Array.isArray(c)&&c[0]==='curve-state').every(c=>c[1].blockTag===100));
});

test('custom curve buy retains the full requested value through a clamped graduation quote',async()=>{
 const h=harness({sellable:eth('1').toString()}),r=await prepare(h,'buy',{amount:'0.001'});
 assert.equal(r.amountInRaw,eth('0.001').toString());assert.ok(bn(r.expectedRefundWei).gt(0));assert.ok(bn(r.expectedSpendWei).lt(r.amountInRaw));
 const expected=bn(r.expectedOutputRaw).mul(r.amountInRaw).mul(9800).div(bn(r.expectedSpendWei).mul(10000));assert.equal(r.minimumOutputRaw,expected.toString());
 const estimates=h.calls.filter(c=>Array.isArray(c)&&c[0]==='estimate');assert.ok(estimates.every(c=>bn(c[1].value).eq(r.amountInRaw)));
});


test('fifty token holdings preserve node order; fifty-one is rejected before RPC',async()=>{
 const nodes=Array.from({length:50},(_,i)=>ethers.utils.getAddress('0x'+(i+1).toString(16).padStart(40,'0'))),h=harness({traceBalance:true});
 const snapshot=await h.p.getNodeTradingSnapshot(TOKEN,nodes);assert.equal(h.state.balanceReads,50);assert.equal(h.state.balanceMax,4);assert.equal(snapshot.balances.length,50);assert.equal(snapshot.balances[49].nodeAddress,nodes[49]);assert.ok(snapshot.balances.every(row=>row.tokenBalanceRaw===eth('100').toString()));
 const over=harness();await assert.rejects(over.p.getNodeTradingSnapshot(TOKEN,[...nodes,ethers.utils.getAddress('0x'+(51).toString(16).padStart(40,'0'))]),/1 and 50/);assert.equal(over.calls.length,0);
});
