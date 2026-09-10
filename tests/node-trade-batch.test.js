const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),ethers=require('ethers');
const address=n=>ethers.utils.getAddress('0x'+n.toString(16).padStart(40,'0')),TOKEN=address(100);
function harness(options={}){
 const session=Object.freeze({id:'fixture',backupVerified:true,addresses:Object.freeze(Array.from({length:options.count||4},(_,i)=>address(i+1)))});
 const state={active:true,verified:true,now:100000,prepares:[],executes:[],concurrent:0,maxConcurrent:0};
 class Clock extends Date{static now(){return state.now;}}
 const assertCurrent=()=>{if(!state.active)throw Error('selection changed');};
 const vault={MAX_NODES:50,isVerifiedNodeSession:s=>s===session&&state.verified,
  prepareNodeTrade:async(s,index,token,side,percent)=>{
   state.prepares.push(index);state.concurrent++;state.maxConcurrent=Math.max(state.maxConcurrent,state.concurrent);
   await new Promise(r=>setTimeout(r,1));state.concurrent--;
   if(options.blocked?.includes(index))throw Error('insufficient gas');
   const action=options.approvals?.includes(index)?'approve-token':side;
   return Object.freeze({nodeAddress:session.addresses[index],nodeIndex:index,tokenAddress:token,side,percent,action,expiresAt:160000-index,
    maxGasCostWei:String(10+index),maxTotalEthWei:String(100+index),...(options.mismatch?.(index)||{})});
  },
  executeNodeTrade:async(s,review,guard)=>{
   assert.equal(s,session);assert.equal(review.percent,100);state.executes.push(review.nodeIndex);
   if(options.duringExecute)await options.duringExecute(state,review.nodeIndex);
   if(guard)guard();
   if(options.fail===review.nodeIndex)throw Error('nonce changed');
   return Object.freeze({nodeAddress:review.nodeAddress,tokenAddress:review.tokenAddress,action:review.action,side:review.side,txHash:'0x'+(review.nodeIndex+1).toString(16).padStart(64,'0'),status:options.unknown===review.nodeIndex?'unknown':'pending',message:'pending',createdAt:state.now});
  }};
 const src=fs.readFileSync(path.join(__dirname,'../src/lib/node-trade-batch.ts'),'utf8'),m={exports:{}};
 const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext('(function(require,module,exports){'+js+'\n})',{Date:Clock,Error,console})(id=>id==='ethers'?ethers:id==='./node-vault'?vault:id==='./pons-trade'?{tradeAddress:ethers.utils.getAddress}:require(id),m,m.exports);
 return {session,state,b:m.exports,assertCurrent};
}
const prepare=(h,side='buy')=>h.b.prepareNodeTradeBatch(h.session,TOKEN,side,h.assertCurrent);
const execute=(h,b,cb)=>h.b.executeNodeTradeBatch(h.session,b,h.assertCurrent,cb);
test('prepares all nodes with concurrency3, freezes exact subset and adds integer totals',async()=>{
 const h=harness({count:7,blocked:[2,5]}),b=await prepare(h);assert.equal(h.state.maxConcurrent,3);assert.equal(b.entries.length,7);
 assert.equal(b.entries.filter(e=>e.status==='ready').length,5);assert.equal(b.maxGasCostWei,'64');assert.equal(b.maxTotalEthWei,'514');assert.equal(b.expiresAt,159994);
 assert.ok(Object.isFrozen(b)&&Object.isFrozen(b.entries)&&b.entries.every(Object.isFrozen));
 const results=await execute(h,b);assert.deepEqual(h.state.executes,[0,1,3,4,6]);assert.equal(results.filter(r=>r.status==='submitted').length,5);
 await assert.rejects(execute(h,b),/used|invalid/);assert.ok(Object.isFrozen(results)&&results.every(Object.isFrozen));
});
test('any sell approval makes the batch approvals-only and defers all ready sales',async()=>{
 const h=harness({approvals:[1,3]}),b=await prepare(h,'sell');assert.equal(b.mode,'approvals');assert.equal(b.entries[0].status,'deferred');
 assert.equal(b.maxGasCostWei,'24');assert.equal(b.maxTotalEthWei,'204');await execute(h,b);assert.deepEqual(h.state.executes,[1,3]);
 assert.equal(h.state.prepares.length,4);
});
test('unknown or error stops remaining nodes, retains earlier hashes and does not retry',async()=>{
 for(const kind of ['unknown','fail']){
  const h=harness({[kind]:1}),b=await prepare(h),updates=[];const results=await execute(h,b,r=>updates.push(r));
  assert.deepEqual(h.state.executes,[0,1]);assert.equal(results[0].status,'submitted');assert.ok(results[0].operation.txHash);
  assert.equal(results[1].status,kind==='unknown'?'unknown':'error');assert.equal(results[2].status,'not-submitted');assert.equal(updates.length,4);
  await assert.rejects(execute(h,b));assert.deepEqual(h.state.executes,[0,1]);
 }
});
test('forgery, wrong session, expired and all-blocked batches never execute',async()=>{
 for(const kind of ['forged','session','expired','blocked']){
  const h=harness(kind==='blocked'?{blocked:[0,1,2,3]}:{}),b=await prepare(h);if(kind==='expired')h.state.now=160001;
  await assert.rejects(h.b.executeNodeTradeBatch(kind==='session'?{...h.session}:h.session,kind==='forged'?{...b}:b,h.assertCurrent));assert.equal(h.state.executes.length,0);
 }
});
test('concurrent duplicate confirmation cannot start a second batch execution',async()=>{
 const h=harness(),b=await prepare(h);const first=execute(h,b);await assert.rejects(execute(h,b));await first;assert.deepEqual(h.state.executes,[0,1,2,3]);
});
test('observer throws cannot disrupt results, and changing selection cancels following nodes',async()=>{
 const h=harness(),b=await prepare(h);const results=await execute(h,b,r=>{if(r.nodeIndex===0)h.state.active=false;throw Error('observer');});
 assert.deepEqual(h.state.executes,[0]);assert.equal(results[0].status,'submitted');assert.ok(results.slice(1).every(r=>r.status==='not-submitted'));
});
test('selection invalidation during current asynchronous action prevents signing and stops the batch',async()=>{
 const h=harness({duringExecute:async(state,index)=>{if(index===0)state.active=false;}}),b=await prepare(h),r=await execute(h,b);
 assert.equal(r[0].status,'error');assert.ok(r.slice(1).every(x=>x.status==='not-submitted'));assert.deepEqual(h.state.executes,[0]);
});
test('mismatched review identities and unverified session never enter ready subset',async()=>{
 for(const mismatch of [{nodeIndex:99},{nodeAddress:address(99)},{tokenAddress:address(99)},{percent:50},{side:'sell'},{action:'approve-token'}]){
  const h=harness({mismatch:()=>mismatch}),b=await prepare(h);assert.ok(b.entries.every(e=>e.status==='blocked'));await assert.rejects(execute(h,b));
 }
 const h=harness();h.state.verified=false;await assert.rejects(prepare(h));assert.equal(h.state.prepares.length,0);
});


test('fifty-node batches keep concurrency three, ordering, expiry and stop boundaries',async()=>{
 const h=harness({count:50}),b=await prepare(h);assert.equal(b.entries.length,50);assert.equal(h.state.maxConcurrent,3);assert.equal(b.entries[49].nodeAddress,h.session.addresses[49]);assert.equal(b.expiresAt,159951);
 const result=await execute(h,b);assert.equal(result.length,50);assert.deepEqual(h.state.executes,Array.from({length:50},(_,i)=>i));await assert.rejects(execute(h,b),/used/);
 const stopped=harness({count:50,unknown:1}),partial=await execute(stopped,await prepare(stopped));assert.deepEqual(stopped.state.executes,[0,1]);assert.ok(partial.slice(2).every(r=>r.status==='not-submitted'));
 const expired=harness({count:50}),old=await prepare(expired);expired.state.now=old.expiresAt;await assert.rejects(execute(expired,old),/current/);assert.equal(expired.state.executes.length,0);
 const over=harness({count:51});await assert.rejects(prepare(over),/batch size/);assert.equal(over.state.prepares.length,0);
});
