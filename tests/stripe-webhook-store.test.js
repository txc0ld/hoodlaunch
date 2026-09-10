const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{PassThrough}=require('node:stream'),{createRequire}=require('node:module');
function load(file,mocks={}){const filename=path.resolve(file),actual=createRequire(filename),module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const req=name=>Object.hasOwn(mocks,name)?mocks[name]:name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts'),mocks):actual(name);vm.runInNewContext(code,{module,exports:module.exports,require:req,process,Buffer,URL,Date,console,setTimeout,clearTimeout,AbortSignal},{filename});return module.exports;}
function request(raw,signature='signed'){const req=new PassThrough();req.method='POST';req.headers=signature===null?{}:{'stripe-signature':signature};process.nextTick(()=>req.end(raw));return req;}
function response(){return {code:200,status(code){this.code=code;return this;},json(body){this.body=body;},setHeader(){}};}
function harness(t,{event={id:'evt_fixture',type:'customer.subscription.updated',livemode:false,data:{object:{id:'sub_fixture',customer:'cus_fixture'}}},signatureError=false,secret='sk_test_fixture'}={}){
 const names=['STRIPE_WEBHOOK_SECRET','STRIPE_SECRET_KEY','STRIPE_PRO_PRICE_ID'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));Object.assign(process.env,{STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_SECRET_KEY:secret,STRIPE_PRO_PRICE_ID:'price_fixture'});t.after(()=>{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}});
 const seen=[],stripe={webhooks:{constructEvent(raw,signature,secret,tolerance){seen.push({raw,signature,secret,tolerance});if(signatureError)throw Error('bad signature');return event;}}};
 const sync=[];let databaseCalls=0;const route=load('pages/api/stripe-webhook.ts',{'../../src/server/public-services':{stripeClient:()=>stripe,database:()=>{databaseCalls++;return {fixture:'db'};}},'../../src/server/public-subscription-store':{isSubscriptionSyncEventType:type=>['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed'].includes(type),syncSubscriptionEvent:async(...args)=>{sync.push(args);return 'processed';}}}).default;
 return {route,seen,sync,get databaseCalls(){return databaseCalls;}};
}
test('webhook preserves exact raw bytes for Stripe signature verification before synchronization',async t=>{
 const h=harness(t),raw=Buffer.from('{"id":"evt_fixture", "whitespace":true}\n'),res=response();await h.route(request(raw),res);assert.equal(res.code,200);assert.equal(res.body.received,true);assert.equal(Buffer.compare(h.seen[0].raw,raw),0);assert.equal(h.seen[0].signature,'signed');assert.equal(h.seen[0].secret,'whsec_fixture');assert.equal(h.seen[0].tolerance,300);assert.equal(h.sync.length,1);assert.equal(h.sync[0][3],'price_fixture');assert.equal(load('pages/api/stripe-webhook.ts',{'../../src/server/public-services':{stripeClient(){throw Error();},database(){throw Error();}},'../../src/server/public-subscription-store':{}}).config.api.bodyParser,false);
});
test('missing or invalid signatures and oversized bodies never reach the store',async t=>{
 for(const spec of [{signatureError:true},{missing:true}]){const h=harness(t,spec),res=response();await h.route(request(Buffer.from('{}'),spec.missing?null:'signed'),res);assert.notEqual(res.code,200);assert.equal(h.sync.length,0);}
 const h=harness(t),res=response();await h.route(request(Buffer.alloc(256*1024+1)),res);assert.notEqual(res.code,200);assert.equal(h.seen.length,0);assert.equal(h.sync.length,0);
});
test('test/live mode mismatch and connected-account events are rejected before synchronization',async t=>{
 for(const [event,secret] of [[{id:'evt_live',type:'customer.subscription.updated',livemode:true,data:{object:{id:'sub_x',customer:'cus_x'}}},'sk_test_fixture'],[{id:'evt_account',type:'customer.subscription.updated',livemode:false,account:'acct_other',data:{object:{id:'sub_x',customer:'cus_x'}}},'sk_test_fixture']]){
  const h=harness(t,{event,secret}),res=response();await h.route(request(Buffer.from('{}')),res);assert.notEqual(res.code,200);assert.equal(h.sync.length,0);
 }
});
test('signed unknown events are acknowledged without database or synchronization work',async t=>{
 const h=harness(t,{event:{id:'evt_unknown',type:'invoice.paid',livemode:false,data:{object:{id:'in_fixture'}}}}),res=response();await h.route(request(Buffer.from('{}')),res);assert.equal(res.code,200);assert.equal(res.body.received,true);assert.equal(h.databaseCalls,0);assert.equal(h.sync.length,0);
});
