const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), {PGlite} = require('@electric-sql/pglite');
const {createRequire} = require('node:module');
function load(file) {const filename=path.resolve(file), actual=createRequire(filename), module={exports:{}}; const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const requireModule=name=>name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts')):actual(name);
 vm.runInNewContext(source,{module,exports:module.exports,require:requireModule,process,Buffer,URL,Date,console,setTimeout,clearTimeout},{filename});return module.exports;}
const {subscriptionCheckout,billingPortal}=load('src/server/public-checkout.ts');
const user='11111111-1111-1111-1111-111111111111', customer='cus_A', origin='https://launch.example.test';
async function harness(t) {
 const db=new PGlite(); await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);');
 await db.exec(fs.readFileSync('db/001_public_services.sql','utf8'));await db.query('insert into auth.users values($1)',[user]);await db.query('insert into public.hood_billing(user_id,customer_id) values($1,$2)',[user,customer]);await db.exec('set role service_role');
 const calls=[],sessions=new Map(),subscriptions=new Map([['sub_A',{id:'sub_A',customer,status:'active',cancel_at_period_end:false,items:{has_more:false,data:[{price:{id:'price_fixed'},quantity:1}]}}]]),prices=new Map([['price_fixed',{id:'price_fixed',active:true,currency:'usd',unit_amount:1500,billing_scheme:'per_unit',type:'recurring',recurring:{interval:'month',interval_count:1,usage_type:'licensed'},product:{id:'prod_hoodlabs_pro',active:true}}]]),cache=new Map(),controls={};let now=Date.now();
 const database={rpc:async(name,args)=>{if(controls.databaseDelay){now+=controls.databaseDelay;controls.databaseDelay=0;}if((name==='hood_checkout_bind' && controls.bindFail) || (name==='hood_checkout_bind_subscription' && controls.subscriptionBindFail))return {data:null,error:{message:'injected write failure'}};
  try{const query=name==='hood_checkout_reserve'?'select public.hood_checkout_reserve($1,$2::jsonb,$3,$4,$5) as result':name==='hood_checkout_bind_subscription'?'select public.hood_checkout_bind_subscription($1,$2,$3,$4) as result':'select public.hood_checkout_bind($1,$2,$3) as result';
   const values=name==='hood_checkout_reserve'?[args.p_user,JSON.stringify(args.p_request),args.p_expected_key,args.p_expired_session,args.p_canceled_subscription||null]:name==='hood_checkout_bind_subscription'?[args.p_user,args.p_key,args.p_session,args.p_subscription]:[args.p_user,args.p_key,args.p_session];
   const result=await db.query(query,values);return {data:result.rows[0].result,error:null};}catch(error){return {data:null,error};}}};
 const stripe={checkout:{sessions:{create:async(payload,options)=>{calls.push({type:'create',payload:JSON.parse(JSON.stringify(payload)),key:options.idempotencyKey});
   if(controls.failBefore){controls.failBefore=false;throw Error('transport failed before creation');}
   const old=cache.get(options.idempotencyKey);if(old && now-old.created<86400000){assert.deepEqual(JSON.parse(JSON.stringify(payload)),old.payload);return sessions.get(old.id);}
   const id='cs_test_'+(sessions.size+1),session={id,customer:payload.customer,mode:payload.mode,client_reference_id:payload.client_reference_id,expires_at:payload.expires_at,success_url:payload.success_url,cancel_url:payload.cancel_url,status:'open',subscription:'sub_A',url:'https://checkout.stripe.com/c/pay/'+id,line_items:{has_more:false,data:[{quantity:1,price:{id:payload.line_items[0].price}}]}};
   sessions.set(id,session);cache.set(options.idempotencyKey,{created:now,id,payload:JSON.parse(JSON.stringify(payload))});
   if(controls.failAfter){controls.failAfter=false;throw Error('transport failed after creation');}return session;},
   retrieve:async(id,params)=>{calls.push({type:'retrieve',id});assert.deepEqual(Array.from(params.expand),['line_items.data.price']);if(controls.retrieveFail)throw Error('transport failed retrieving');return sessions.get(id);}}},
  prices:{retrieve:async(id,params)=>{calls.push({type:'price',id});assert.deepEqual(Array.from(params.expand),['product']);if(controls.priceFail)throw Error('inert Stripe price read failed');return prices.get(id);}},
  subscriptions:{retrieve:async(id)=>{calls.push({type:'subscription',id});if(controls.subscriptionReadDelay)await controls.subscriptionReadDelay();if(controls.subscriptionFail)throw Error('subscription read failed');return subscriptions.get(id);}},
  billingPortal:{sessions:{create:async(params)=>{calls.push({type:'portal',params});return {url:'https://billing.stripe.com/p/session/test'};}}}};
 const oldPortal=process.env.STRIPE_PORTAL_CONFIGURATION_ID;process.env.STRIPE_PORTAL_CONFIGURATION_ID='bpc_HOODLABS';
 t.after(async()=>{if(oldPortal===undefined)delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;else process.env.STRIPE_PORTAL_CONFIGURATION_ID=oldPortal;await db.close();});
 return {db,database,stripe,calls,sessions,subscriptions,prices,controls,now:()=>now,advance:ms=>{now+=ms;},run:(price='price_fixed',url=origin)=>subscriptionCheckout(database,stripe,user,customer,price,url,()=>now)};
}
function creates(h){return h.calls.filter(c=>c.type==='create');}
test('durable checkout uses fixed 23h expiry, binds ID, retrieves and reuses one open session',async t=>{
 const h=await harness(t),url=await h.run();assert.match(url,/checkout.stripe.com/);assert.equal(h.sessions.size,1);await h.run();assert.equal(creates(h).length,1);
 const row=(await h.db.query('select * from hood_billing')).rows[0];assert.equal(row.checkout_session_id,'cs_test_1');assert.equal(Number(row.checkout_expires_at),creates(h)[0].payload.expires_at);
 assert.ok(row.checkout_expires_at*1000-h.now()<=23*3600000);assert.ok(row.checkout_expires_at*1000-h.now()>22*3600000);
});
test('original 25-hour rollover reproduction fails closed after transport failure, without a new payable session',async t=>{
 const h=await harness(t);h.controls.failBefore=true;await assert.rejects(h.run());assert.equal(h.sessions.size,0);
 h.advance((24*60+50)*60000);await assert.rejects(h.run(),/reconciliation/);
 h.advance(11*60000);await assert.rejects(h.run(),/reconciliation/);assert.equal(creates(h).length,1);assert.equal(h.sessions.size,0);
});
test('accepted-but-unknown create replays exact parameters within window; age never rotates unknown ID',async t=>{
 const h=await harness(t);h.controls.failAfter=true;await assert.rejects(h.run());const first=creates(h)[0];h.advance(3600000);await h.run();assert.equal(h.sessions.size,1);assert.equal(creates(h)[1].key,first.key);assert.deepEqual(creates(h)[1].payload,first.payload);
 const other=await harness(t);other.controls.failAfter=true;await assert.rejects(other.run());other.advance(26*3600000);await assert.rejects(other.run(),/reconciliation/);assert.equal(other.sessions.size,1);assert.equal(creates(other).length,1);
});
test('completed session goes to dedicated portal even before entitlement catches up',async t=>{
 const h=await harness(t);await h.run();h.sessions.get('cs_test_1').status='complete';assert.match(await h.run(),/billing.stripe.com/);
 assert.equal(creates(h).length,1);const portal=h.calls.find(c=>c.type==='portal');assert.equal(portal.params.configuration,'bpc_HOODLABS');assert.equal(portal.params.customer,customer);
});
test('only verified expired session rotates through expected key/session CAS; concurrent requests share winner',async t=>{
 const h=await harness(t);await h.run();const old=(await h.db.query('select * from hood_billing')).rows[0];h.sessions.get('cs_test_1').status='expired';
 const urls=await Promise.all([h.run(),h.run()]);assert.equal(urls[0],urls[1]);assert.equal(h.sessions.size,2);
 const current=(await h.db.query('select * from hood_billing')).rows[0];assert.notEqual(current.checkout_key,old.checkout_key);
 const stale=await h.database.rpc('hood_checkout_reserve',{p_user:user,p_request:{...creates(h)[0].payload,expires_at:undefined},p_expected_key:old.checkout_key,p_expired_session:old.checkout_session_id});
 assert.equal(stale.error,null);assert.equal(stale.data.key,current.checkout_key);
});
test('price/origin changes and mismatched retrieved customer/mode/price fail closed',async t=>{
 const h=await harness(t);await h.run();await assert.rejects(()=>h.run('price_changed'),/terms/);await assert.rejects(()=>h.run('price_fixed','https://changed.example.test'),/reconciliation/);
 const session=h.sessions.get('cs_test_1');for(const [field,value] of [['customer','cus_other'],['mode','payment'],['expires_at',1],['client_reference_id','other']]){const old=session[field];session[field]=value;await assert.rejects(h.run(),/reconciliation/);session[field]=old;}
 session.line_items.data[0].price.id='price_other';await assert.rejects(h.run(),/reconciliation/);assert.equal(creates(h).length,1);
});
test('slow reservation/database work crosses final create cutoff without issuing Stripe create',async t=>{
 const h=await harness(t);h.controls.failBefore=true;await assert.rejects(h.run());
 const row=(await h.db.query('select * from hood_billing')).rows[0];h.advance(Number(row.checkout_expires_at)*1000-h.now()-31*60000+1000);
 await assert.rejects(h.run(),/reconciliation/);assert.equal(creates(h).length,1);
 const second=await harness(t);second.controls.databaseDelay=23*3600000;await assert.rejects(second.run(),/reconciliation/);assert.equal(creates(second).length,0);
});
test('ID binding failure preserves unknown reservation and retrieval failure never creates a second session',async t=>{
 const h=await harness(t);h.controls.bindFail=true;await assert.rejects(h.run(),/reconciliation/);assert.equal(h.sessions.size,1);h.controls.bindFail=false;await h.run();assert.equal(h.sessions.size,1);
 h.controls.retrieveFail=true;await assert.rejects(h.run());assert.equal(creates(h).length,2);assert.equal(h.sessions.size,1);
});
test('anonymous SQL callers cannot reserve/bind; known ID cannot be replaced with another ID',async t=>{
 const h=await harness(t);await h.run();const row=(await h.db.query('select * from hood_billing')).rows[0];
 const changed=await h.database.rpc('hood_checkout_bind',{p_user:user,p_key:row.checkout_key,p_session:'cs_test_other'});assert.equal(changed.data,false);
 await h.db.exec('reset role;set role anon');await assert.rejects(h.db.query('select public.hood_checkout_bind($1,$2,$3)',[user,row.checkout_key,'cs_test_other']));
 await assert.rejects(h.db.query('select public.hood_checkout_reserve($1,$2)',[user,JSON.stringify({})]));
});
test('missing explicit portal configuration fails before creating a portal session',async t=>{
 const h=await harness(t);delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;await assert.rejects(()=>billingPortal(h.stripe,customer,origin),/configuration/);assert.equal(h.calls.length,0);
});
test('exact 31-minute remaining boundary can retry, one millisecond below it cannot',async t=>{
 const h=await harness(t);h.controls.failBefore=true;await assert.rejects(h.run());
 const row=(await h.db.query('select * from hood_billing')).rows[0];h.advance(Number(row.checkout_expires_at)*1000-h.now()-31*60000);await h.run();assert.equal(h.sessions.size,1);
 const below=await harness(t);below.controls.failBefore=true;await assert.rejects(below.run());
 const other=(await below.db.query('select * from hood_billing')).rows[0];below.advance(Number(other.checkout_expires_at)*1000-below.now()-31*60000+1);await assert.rejects(below.run(),/reconciliation/);assert.equal(below.sessions.size,0);assert.equal(creates(below).length,1);
});
test('missing or malformed portal configuration blocks checkout before reservation or Stripe creation',async t=>{
 const h=await harness(t);
 for(const value of [undefined,'bpc_','https://evil.test','bpc_bad-config']){
   if(value===undefined)delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;else process.env.STRIPE_PORTAL_CONFIGURATION_ID=value;
   await assert.rejects(h.run(),/configuration/);assert.equal(h.calls.length,0);
   assert.equal((await h.db.query('select checkout_key from hood_billing')).rows[0].checkout_key,null);
 }
});
test('checkout validates authoritative exact US$15 monthly licensed price before reservation',async t=>{
 const h=await harness(t),baseline=JSON.stringify(h.prices.get('price_fixed'));
 const mutations=[
  price=>price.product={...price.product,id:'prod_other'},price=>price.product={...price.product,active:false},price=>price.currency='aud',price=>price.unit_amount=1499,
  price=>price.active=false,price=>price.billing_scheme='tiered',price=>price.type='one_time',price=>price.recurring.interval='year',price=>price.recurring.interval_count=2,price=>price.recurring.usage_type='metered',
 ];
 for(const mutate of mutations){const price=JSON.parse(baseline);mutate(price);h.prices.set('price_fixed',price);await assert.rejects(h.run(),/terms/);assert.equal(creates(h).length,0);assert.equal((await h.db.query('select checkout_key from hood_billing')).rows[0].checkout_key,null);}
});
test('unknown Stripe price state denies checkout without durable or payable side effects',async t=>{
 const h=await harness(t);h.controls.priceFail=true;await assert.rejects(h.run(),/terms/);assert.equal(creates(h).length,0);assert.equal((await h.db.query('select checkout_key from hood_billing')).rows[0].checkout_key,null);
});
test('verified terminal cancellation creates exactly one new checkout generation',async t=>{
 const h=await harness(t);await h.run();h.sessions.get('cs_test_1').status='complete';h.subscriptions.get('sub_A').status='canceled';
 const old=(await h.db.query('select * from hood_billing')).rows[0];const url=await h.run();assert.match(url,/cs_test_2/);await h.run();assert.equal(h.sessions.size,2);
 const current=(await h.db.query('select * from hood_billing')).rows[0];assert.notEqual(current.checkout_key,old.checkout_key);assert.equal(current.checkout_session_id,'cs_test_2');assert.equal(current.checkout_subscription_id,null);
 assert.notEqual(creates(h)[0].key,creates(h)[1].key);
});
test('scheduled cancellation and every non-canceled or unknown status stay in the portal',async t=>{
 const h=await harness(t);await h.run();h.sessions.get('cs_test_1').status='complete';const subscription=h.subscriptions.get('sub_A');
 for(const status of ['active','past_due','unpaid','paused','incomplete','incomplete_expired','trialing','unknown']){
   subscription.status=status;subscription.cancel_at_period_end=true;assert.match(await h.run(),/billing.stripe.com/);assert.equal(h.sessions.size,1);
 }
 assert.equal((await h.db.query('select checkout_subscription_id from hood_billing')).rows[0].checkout_subscription_id,'sub_A');
});
test('missing or drifting subscription identity, customer, price and quantity never rotate',async t=>{
 const h=await harness(t);await h.run();const session=h.sessions.get('cs_test_1'),subscription=h.subscriptions.get('sub_A');session.status='complete';
 for(const bad of [null,'bad',{id:'sub_A'}]){session.subscription=bad;await assert.rejects(h.run());}session.subscription='sub_A';
 for(const [field,value] of [['id','sub_other'],['customer','cus_other']]){const old=subscription[field];subscription[field]=value;await assert.rejects(h.run());subscription[field]=old;}
 const item=subscription.items.data[0];for(const mutation of [()=>item.quantity=2,()=>item.price.id='price_other',()=>subscription.items.has_more=true,()=>subscription.items.data.push({...item})]){
   mutation();await assert.rejects(h.run());item.quantity=1;item.price.id='price_fixed';subscription.items.has_more=false;subscription.items.data=[item];
 }
 await h.run(); // Binds sub_A while active.
 h.subscriptions.set('sub_other',{...subscription,id:'sub_other',status:'canceled'});session.subscription='sub_other';await assert.rejects(h.run());
 assert.equal(creates(h).length,1);assert.equal(h.sessions.size,1);
});
test('subscription retrieval and durable binding failures do not permit rejoin',async t=>{
 const h=await harness(t);await h.run();h.sessions.get('cs_test_1').status='complete';h.subscriptions.get('sub_A').status='canceled';
 h.controls.subscriptionFail=true;await assert.rejects(h.run());h.controls.subscriptionFail=false;
 h.controls.subscriptionBindFail=true;await assert.rejects(h.run());h.controls.subscriptionBindFail=false;
 assert.equal(creates(h).length,1);assert.equal((await h.db.query('select checkout_subscription_id from hood_billing')).rows[0].checkout_subscription_id,null);
});
test('delayed canceled-subscription requests lose CAS safely and reuse one winning checkout',async t=>{
 const h=await harness(t);await h.run();h.sessions.get('cs_test_1').status='complete';h.subscriptions.get('sub_A').status='canceled';
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});let reads=0;
 h.controls.subscriptionReadDelay=async()=>{if(++reads===1){entered();await gate;}};
 const delayed=h.run();await started;const immediate=await Promise.all([h.run(),h.run(),h.run()]);release();const late=await delayed;
 assert.ok(immediate.every(url=>url===late));assert.equal(h.sessions.size,2);
 const keys=new Set(creates(h).slice(1).map(call=>call.key));assert.equal(keys.size,1);
});
test('subscription binding is immutable and rotation compares key, session and subscription',async t=>{
 const h=await harness(t);await h.run();h.sessions.get('cs_test_1').status='complete';await h.run();const old=(await h.db.query('select * from hood_billing')).rows[0];
 assert.equal((await h.database.rpc('hood_checkout_bind_subscription',{p_user:user,p_key:old.checkout_key,p_session:old.checkout_session_id,p_subscription:'sub_other'})).data,false);
 const request={...creates(h)[0].payload};delete request.expires_at;
 for(const change of [{p_canceled_subscription:'sub_other'},{p_expired_session:'cs_test_other'},{p_expected_key:'22222222-2222-2222-2222-222222222222'},{p_canceled_subscription:null}]){
   const result=await h.database.rpc('hood_checkout_reserve',{p_user:user,p_request:request,p_expected_key:old.checkout_key,p_expired_session:old.checkout_session_id,p_canceled_subscription:'sub_A',...change});assert.equal(result.data.key,old.checkout_key);
 }
 h.subscriptions.get('sub_A').status='canceled';await h.run();const current=(await h.db.query('select * from hood_billing')).rows[0];
 assert.equal((await h.database.rpc('hood_checkout_bind_subscription',{p_user:user,p_key:old.checkout_key,p_session:old.checkout_session_id,p_subscription:'sub_A'})).data,false);
 const stale=await h.database.rpc('hood_checkout_reserve',{p_user:user,p_request:request,p_expected_key:old.checkout_key,p_expired_session:old.checkout_session_id,p_canceled_subscription:'sub_A'});assert.equal(stale.data.key,current.checkout_key);
 await h.db.exec('reset role;set role anon');await assert.rejects(h.db.query('select public.hood_checkout_bind_subscription($1,$2,$3,$4)',[user,old.checkout_key,old.checkout_session_id,'sub_A']));
});
test('canceled rejoin still requires portal configuration and exact configured price',async t=>{
 const h=await harness(t);await h.run();h.sessions.get('cs_test_1').status='complete';h.subscriptions.get('sub_A').status='canceled';
 await assert.rejects(()=>h.run('price_new'));delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;await assert.rejects(h.run(),/configuration/);assert.equal(h.sessions.size,1);
});
