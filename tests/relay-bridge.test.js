const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const ethers=require('ethers');
const fixture=require('./fixtures/relay-quote-50.json');
const abi=new ethers.utils.Interface(['function depositNative(address depositor,bytes32 id) payable','event RelayNativeDeposit(address from,uint256 amount,bytes32 id)','event FundsMovement(address from,address to,address currency,uint256 amount,bytes metadata)']);
const testMnemonic='test test test test test test test test test test test junk';
const wallet=ethers.Wallet.fromMnemonic(testMnemonic); // Public disposable test mnemonic, never broadcast.
const bn=ethers.BigNumber.from;
function harness(options={}) {
  const memory=new Map(),calls=[],modules={},mutable={now:Date.now(),active:true,stage:'pending'};
  class Clock extends Date {static now(){return mutable.now;}}
  let busy=false;
  const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>{if(options.storageFail)throw Error('storage');memory.set(k,v);}};
  class Provider {
    constructor(connection){this.dest=connection.url.includes('robinhood');assert.equal(connection.timeout,15000);}
    async send(method,args){calls.push(method);if(method==='eth_chainId')return options.wrongChain?'0x99':this.dest?'0x1237':'0x1';
      assert.equal(method,'eth_sendRawTransaction');assert.equal(memory.size,1,'must persist before broadcast');if(options.broadcastFail)throw Error('uncertain');return ethers.utils.keccak256(args[0]);}
    async getBalance(node,block){assert.equal(node,wallet.address);if(this.dest)return bn(block===99?0:options.lowDestination?1:'10000000000000000');return bn(options.lowBalance?'1':'1000000000000000000');}
    async estimateGas(){if(options.forgetDuringEstimate)mutable.active=false;return bn(options.hugeGas?200000:35000);}
    async getCode(){return options.wrongRouterCode?'0x00':require('./fixtures/relay-router-runtime.json').runtimeBytecode;}
    async getFeeData(){if(options.prepareDelay)mutable.now+=options.prepareDelay;return {maxFeePerGas:bn(options.highFee?'200000000000':'2000000000'),maxPriorityFeePerGas:bn('1000000000')};}
    async getTransactionCount(){return options.changedNonce?2:0;}
    async getTransactionReceipt(hash){
      if(this.dest){const r=JSON.parse([...memory.values()][0]);const router='0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
        const event=abi.encodeEventLog(abi.getEvent('FundsMovement'),[options.wrongPaymentFrom?wallet.address:router,options.wrongPaymentRecipient?router:wallet.address,ethers.constants.AddressZero,r.minimumOutputWei,options.wrongOrder?'0x'+'99'.repeat(32):r.orderId]);
        return {status:options.destinationFailure?0:1,confirmations:3,transactionHash:hash,to:fixture.protocol.v2.paymentDetails.depository,blockNumber:100,logs:options.noPayment?[]:[{address:router,...event}]};}
      if(mutable.stage==='pending')return null;
      const r=JSON.parse([...memory.values()][0]);const event=abi.encodeEventLog(abi.getEvent('RelayNativeDeposit'),[wallet.address,r.amountWei,r.orderId]);
      return {transactionHash:hash,from:wallet.address,to:fixture.protocol.v2.paymentDetails.depository,status:1,confirmations:3,logs:options.missingDeposit?[]:[{address:fixture.protocol.v2.paymentDetails.depository,...event}]};
    }
    async getTransaction(hash){const r=JSON.parse([...memory.values()][0]);return {hash,chainId:1,from:wallet.address,to:fixture.protocol.v2.paymentDetails.depository,nonce:0,value:bn(r.amountWei),data:abi.encodeFunctionData('depositNative',[wallet.address,r.orderId])};}
    removeAllListeners(){}
  }
  class FixtureWallet extends ethers.Wallet {static createRandom(){return ethers.Wallet.fromMnemonic(testMnemonic);}}
  const context={console,BigInt,Error,Date:Clock,setTimeout,clearTimeout,AbortController,window:{localStorage:storage},navigator:{locks:{request:async(name,opt,fn)=>{
    if(options.busy || busy)return fn(null);busy=true;try{return await fn({name});}finally{busy=false;}
  }}},fetch:async(url,init)=>{
    calls.push(url);
    let data;
    if(url.endsWith('/quote/v2')){
      assert.equal(JSON.parse(init.body).slippageTolerance,'50');data=quote();if(options.tamperQuote)options.tamperQuote(data);
    }else{const r=JSON.parse([...memory.values()][0]);data={status:options.status||'success',originChainId:1,destinationChainId:4663,inTxHashes:[options.wrongOrigin?'0x'+'11'.repeat(32):r.sourceTxHash],txHashes:['0x'+'22'.repeat(32)]};}
    return {ok:true,text:async()=>JSON.stringify(data)};
  }};
  function load(name){if(modules[name])return modules[name];const module={exports:{}};modules[name]=module.exports;
    const source=fs.readFileSync(path.join(__dirname,'../src/lib/'+name+'.ts'),'utf8');
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext('(function(require,module,exports){'+js+'\n})',context)(id=>id==='ethers'?{...ethers,Wallet:options.fixedRoot?FixtureWallet:ethers.Wallet,providers:{JsonRpcProvider:Provider}}:id.startsWith('./')?load(id.slice(2)):require(id),module,module.exports);
    return module.exports;
  }
  function quote(){const q=JSON.parse(JSON.stringify(fixture));const old=q.details.sender;const fresh=JSON.parse(JSON.stringify(q).replaceAll(old,wallet.address));
    const o=fresh.protocol.v2.orderData;o.output.deadline=Math.floor(mutable.now/1000)+(options.orderSeconds||7*86400);o.inputs[0].refunds.forEach(r=>r.deadline=o.output.deadline);
    fresh.protocol.v2.orderId=load('relay-order').hashRelayOrder(o);
    fresh.steps[0].items[0].data.data=abi.encodeFunctionData('depositNative',[wallet.address,fresh.protocol.v2.orderId]);return fresh;}
  return {order:load('relay-order'),bridge:load('relay-bridge'),vault:()=>load('node-vault'),quote,calls,memory,mutable,assertActive:()=>{if(!mutable.active)throw Error('session forgotten');}};
}
const prepare=h=>h.bridge.prepareRelayBridge(h,0,wallet.address,'0.005',h.assertActive);
const execute=(h,r)=>h.bridge.executeRelayBridge(h,r,h.assertActive,tx=>wallet.signTransaction(tx));
test('live explicit50bps fixture validates and EIP712 commitment exactly matches captured order ID',()=>{
 const h=harness();const q=fixture;const created=(q.protocol.v2.orderData.output.deadline-7*86400)*1000;
 const r=h.bridge.validateRelayQuote(q,q.details.sender,q.details.currencyIn.amount,created);
 assert.equal(r.orderId,q.protocol.v2.orderId);assert.equal(r.minimum,q.details.currencyOut.minimumAmount);
});
test('rejects all arbitrary recipient/assets/chains/calls/order/value/calldata/fee/refund and slippage mutations',()=>{
 const h=harness();const changes=[q=>q.details.recipient=ethers.constants.AddressZero,q=>q.details.currencyOut.currency.chainId=1,
 q=>q.protocol.v2.orderData.output.payments[0].recipient=ethers.constants.AddressZero,q=>q.protocol.v2.orderData.output.calls=['0x1234'],
 q=>q.protocol.v2.orderData.inputs[0].refunds[0].recipient=ethers.constants.AddressZero,q=>q.protocol.v2.orderData.inputs[0].refunds[0].currency=wallet.address,
 q=>q.protocol.v2.orderData.output.extraData='0x',q=>q.protocol.v2.orderData.inputs[0].payment.amount='1',q=>q.protocol.v2.orderId='0x'+'11'.repeat(32),
 q=>q.steps[0].items[0].data.to=wallet.address,q=>q.steps[0].items[0].data.value='1',q=>q.steps[0].items[0].data.data+='00',
 q=>q.steps[0].items.push(q.steps[0].items[0]),q=>q.fees.app.amount='1',q=>q.details.slippageTolerance.total='200',
 q=>q.details.currencyOut.minimumAmount='1',q=>q.protocol.v2.orderData.output.deadline=1,q=>q.protocol.v2.orderData.fees=[{}],
 q=>q.protocol.v2.orderData.uncommittedExtra='value'];
 for(const change of changes){const q=h.quote();change(q);assert.throws(()=>h.bridge.validateRelayQuote(q,wallet.address,'5000000000000000'));}
});
test('review is immutable exact ETH+gas cap, signs only reviewed transaction and persists before one broadcast',async()=>{
 const h=harness(),r=await prepare(h);assert.ok(Object.isFrozen(r));assert.equal(r.amountWei,'5000000000000000');assert.equal(r.gasLimit,'42000');
 assert.equal(r.maxGasCostWei,'84000000000000');assert.equal(r.maxTotalWei,'5084000000000000');
 const op=await execute(h,r);assert.equal(op.status,'pending');assert.equal(h.calls.filter(x=>x==='eth_sendRawTransaction').length,1);
 await assert.rejects(execute(h,r));await assert.rejects(prepare(h));
 assert.equal([...h.memory.values()].some(x=>x.includes(wallet.privateKey)),false);
 assert.deepEqual(Object.keys(op).sort(),['createdAt','message','nodeAddress','requestId','sourceTxHash','status']);
});
test('forged/copied review, wrong owner, expired review and forgotten session never sign',async()=>{
 for(const kind of ['copied','owner','expired','forgotten']){const h=harness(),r=await prepare(h);let signed=0;
 if(kind==='expired')h.mutable.now+=90001;if(kind==='forgotten')h.mutable.active=false;
 await assert.rejects(h.bridge.executeRelayBridge(kind==='owner'?{}:h,kind==='copied'?{...r}:r,h.assertActive,async()=>{signed++;return '';}));assert.equal(signed,0);}
});
test('balance/gas/network/session failures, disabled storage and lock contention never broadcast',async()=>{
 for(const options of [{lowBalance:true},{hugeGas:true},{highFee:true},{wrongChain:true},{forgetDuringEstimate:true}]){
 const h=harness(options);await assert.rejects(prepare(h));assert.equal(h.calls.includes('eth_sendRawTransaction'),false);}
 for(const options of [{storageFail:true},{busy:true}]){const h=harness(options);const r=await prepare(h);await assert.rejects(execute(h,r));assert.equal(h.calls.includes('eth_sendRawTransaction'),false);}
});
test('ambiguous broadcast remains recoverable and blocks replay',async()=>{
 const h=harness({broadcastFail:true}),r=await prepare(h);assert.equal((await execute(h,r)).status,'unknown');
 assert.equal(h.bridge.getNodeBridgeOperation(wallet.address).status,'unknown');await assert.rejects(prepare(h));
 const recovered=await h.bridge.refreshNodeBridgeOperation(wallet.address);assert.equal(recovered.status,'unknown');assert.equal(h.calls.filter(x=>x==='eth_sendRawTransaction').length,1);
});
test('source deposit alone is not completion; correlated receipt+destination balance verifies completion',async()=>{
 const h=harness();await execute(h,await prepare(h));assert.equal((await h.bridge.refreshNodeBridgeOperation(wallet.address)).status,'unknown');
 h.mutable.stage='confirmed';const op=await h.bridge.refreshNodeBridgeOperation(wallet.address);assert.equal(op.status,'complete');assert.ok(op.destinationTxHash);
 assert.ok(await prepare(h));
});
test('missing deposit log, wrong origin, destination failure, insufficient increase and reported refund never complete',async()=>{
 for(const options of [{missingDeposit:true},{wrongOrigin:true},{destinationFailure:true},{lowDestination:true},{status:'refund'},{status:'failure'},{status:'submitted'}]){
 const h=harness(options);await execute(h,await prepare(h));h.mutable.stage='confirmed';const op=await h.bridge.refreshNodeBridgeOperation(wallet.address);assert.notEqual(op.status,'complete');await assert.rejects(prepare(h));}
});
test('vault rejects generated-unverified, forged and forgotten sessions before bridge network work',async()=>{
 const h=harness(),v=h.vault(),session=v.createNodeSession(1);
 await assert.rejects(v.prepareNodeBridge(session,0,'0.005'));await assert.rejects(v.prepareNodeBridge({...session,backupVerified:true},0,'0.005'));
 v.forgetNodeSession(session);await assert.rejects(v.prepareNodeBridge(session,0,'0.005'));assert.equal(h.calls.length,0);
});

test('EIP712 hashing matches the official normalized SDK v1 test vector',()=>{
 const vector=require('./fixtures/relay-order-sdk-vector.json');const h=harness();assert.equal(h.order.hashRelayOrder(vector.order),vector.expected);
});
test('expiry during signing cannot broadcast or create a durable operation',async()=>{
 const h=harness(),r=await prepare(h);await assert.rejects(h.bridge.executeRelayBridge(h,r,h.assertActive,async tx=>{const signed=await wallet.signTransaction(tx);h.mutable.now+=90001;return signed;}));
 assert.equal(h.calls.includes('eth_sendRawTransaction'),false);assert.equal(h.memory.size,0);
});

test('restored vault signs only the selected reviewed node, with cross-session and forget rejection',async()=>{
 const h=harness({fixedRoot:true}),v=h.vault(),original=v.createNodeSession(2);
 const backup=await v.encryptNodeBackup(original,'disposable bridge test password');
 const restored=await v.restoreNodeBackup(backup,'disposable bridge test password');
 const other=await v.restoreNodeBackup(backup,'disposable bridge test password');
 const review=await v.prepareNodeBridge(restored,0,'0.005');
 await assert.rejects(v.executeNodeBridge(other,review));
 const operation=await v.executeNodeBridge(restored,review);assert.equal(operation.nodeAddress,restored.addresses[0]);
 assert.equal(h.calls.filter(x=>x==='eth_sendRawTransaction').length,1);
 v.forgetNodeSession(restored);await assert.rejects(v.executeNodeBridge(restored,review));
 v.forgetNodeSession(original);v.forgetNodeSession(other);
});

test('zero or inconsistent persisted amounts fail closed before status lookup',async()=>{
 for(const patch of [{amountWei:'0'},{minimumOutputWei:'0'},{minimumOutputWei:'999999999999999999999'}]){
 const h=harness(),r=await prepare(h);await execute(h,r);const [key,raw]=[...h.memory.entries()][0];h.memory.set(key,JSON.stringify({...JSON.parse(raw),...patch}));
 assert.throws(()=>h.bridge.getNodeBridgeOperation(wallet.address));await assert.rejects(h.bridge.refreshNodeBridgeOperation(wallet.address));await assert.rejects(prepare(h));
 }
});

test('unrelated successful router transaction plus node credit cannot complete without committed payment event',async()=>{
 for(const options of [{noPayment:true},{wrongOrder:true},{wrongPaymentRecipient:true},{wrongPaymentFrom:true},{wrongRouterCode:true}]){
 const h=harness(options);await execute(h,await prepare(h));h.mutable.stage='confirmed';const result=await h.bridge.refreshNodeBridgeOperation(wallet.address);
 assert.notEqual(result.status,'complete');await assert.rejects(prepare(h));
 }
});
test('review expiry cannot outlive protocol deadline minus safety buffer after delayed RPC preparation',async()=>{
 const h=harness({orderSeconds:91,prepareDelay:2000});const start=h.mutable.now;const r=await prepare(h);
 assert.ok(r.expiresAt<=Math.floor(start/1000)*1000+61000);assert.ok(r.expiresAt<h.mutable.now+90000);
 const slow=harness({orderSeconds:91,prepareDelay:65000});await assert.rejects(prepare(slow),/deadline expired/);
});
