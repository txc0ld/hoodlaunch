const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{PGlite}=require('@electric-sql/pglite'),{createRequire}=require('node:module');
const U='11111111-1111-1111-1111-111111111111',V='22222222-2222-2222-2222-222222222222',CUSTOMER='cus_bound',PRICE='price_fixed',SUB='sub_fixture';
function load(file,mocks={}){const filename=path.resolve(file),actual=createRequire(filename),module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const req=name=>Object.hasOwn(mocks,name)?mocks[name]:name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts'),mocks):actual(name);vm.runInNewContext(code,{module,exports:module.exports,require:req,process,Date,console},{filename});return module.exports;}
async function sqlHarness(t){const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');await db.exec(fs.readFileSync('db/001_public_services.sql','utf8'));await db.exec(fs.readFileSync('db/003_subscription_store.sql','utf8'));await db.query('insert into auth.users values($1),($2)',[U,V]);await db.query('insert into hood_billing(user_id,customer_id) values($1,$2)',[U,CUSTOMER]);await db.exec('set role service_role');t.after(()=>db.close());
 const api={from(name){assert.equal(name,'hood_billing');return {select(){return {eq(column,value){assert.equal(column,'customer_id');return {maybeSingle:async()=>{try{const q=await db.query('select user_id from hood_billing where customer_id=$1',[value]);return {data:q.rows[0]||null,error:null};}catch(error){return {data:null,error};}}};}};}};},async rpc(name,args){try{const entries=Object.entries(args),q=await db.query(`select public.${name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) as result`,entries.map(([,v])=>v));return {data:q.rows[0].result,error:null};}catch(error){return {data:null,error};}}};
 return {db,api};}
function subscription(overrides={}){return {id:SUB,customer:CUSTOMER,status:'active',cancel_at_period_end:false,canceled_at:null,ended_at:null,items:{data:[{price:{id:PRICE},quantity:1,current_period_end:2_000_000_000}]},...overrides};}
function event(id='evt_fixture',type='customer.subscription.updated',object={id:SUB,customer:CUSTOMER}){return {id,type,livemode:false,data:{object}};}
function stripe(sequence){const calls=[];return {calls,subscriptions:{retrieve:async id=>{calls.push(id);const value=sequence.shift();if(value instanceof Error)throw value;return structuredClone(value);}}};}
test('SQL begin/complete fences stale workers, processes atomically and preserves strict customer binding',async t=>{
 const h=await sqlHarness(t),begin=(id,type='customer.subscription.updated')=>h.api.rpc('hood_subscription_begin',{p_event:id,p_type:type,p_subscription:SUB,p_customer:CUSTOMER});
 const first=(await begin('evt_one')).data,retry=(await begin('evt_one')).data,next=(await begin('evt_two')).data;
 assert.deepEqual({...first},{ignored:false,processed:false,version:1});assert.equal(retry.version,2);assert.equal(next.version,3);
 const base={p_subscription:SUB,p_customer:CUSTOMER,p_price:PRICE,p_status:'active',p_period_end:2_000_000_000,p_cancel_at_period_end:false,p_canceled_at:null,p_ended_at:null};
 assert.equal((await h.api.rpc('hood_subscription_complete',{p_event:'evt_one',p_version:first.version,...base})).data,false);
 assert.equal((await h.api.rpc('hood_subscription_complete',{p_event:'evt_two',p_version:next.version,...base})).data,true);
 let rows=(await h.db.query('select subscription_id,user_id,customer_id,price_id,status,version from hood_subscription_snapshots')).rows;assert.equal(rows.length,1);assert.equal(rows[0].user_id,U);assert.equal(Number(rows[0].version),3);
 assert.equal((await h.db.query("select processed_at is not null as done from hood_subscription_events where event_id='evt_one'")).rows[0].done,false);
 const duplicate=(await begin('evt_two')).data;assert.equal(duplicate.processed,true);assert.equal(duplicate.version,3);
 const raced=await Promise.all([begin('evt_racea'),begin('evt_raceb')]),ordered=raced.map(x=>x.data).sort((a,b)=>a.version-b.version);
 const completions=await Promise.all([h.api.rpc('hood_subscription_complete',{p_event:'evt_racea',p_version:raced[0].data.version,...base}),h.api.rpc('hood_subscription_complete',{p_event:'evt_raceb',p_version:raced[1].data.version,...base})]);
 assert.equal(completions.filter(x=>x.data===true).length,1);assert.equal(Number((await h.db.query('select version from hood_subscription_snapshots')).rows[0].version),ordered[1].version);
 const drift=(await begin('evt_three')).data;await h.db.query('update hood_billing set customer_id=$1 where user_id=$2',['cus_changed',U]);assert.equal((await h.api.rpc('hood_subscription_complete',{p_event:'evt_three',p_version:drift.version,...base})).data,false);
 rows=(await h.db.query('select version,customer_id from hood_subscription_snapshots')).rows;assert.equal(Number(rows[0].version),ordered[1].version);assert.equal(rows[0].customer_id,CUSTOMER);
});
test('SQL RPCs reject invalid projections and anon/authenticated cannot read or execute',async t=>{
 const h=await sqlHarness(t);await h.db.exec('reset role;set role anon');for(const sql of ['select * from hood_subscription_snapshots','select * from hood_subscription_events',`select public.hood_subscription_begin('evt_bad','customer.subscription.updated','${SUB}','${CUSTOMER}')`])await assert.rejects(h.db.query(sql));
 await h.db.exec('reset role;set role authenticated');await assert.rejects(h.db.query('select * from hood_subscription_snapshots'));await h.db.exec('reset role;set role service_role');
 for(const args of [{p_event:'bad',p_type:'customer.subscription.updated',p_subscription:SUB,p_customer:CUSTOMER},{p_event:'evt_ok',p_type:'invalid.type',p_subscription:SUB,p_customer:CUSTOMER},{p_event:'evt_ok',p_type:'customer.subscription.updated',p_subscription:'bad',p_customer:CUSTOMER}])assert.ok((await h.api.rpc('hood_subscription_begin',args)).error);
});
test('sync fetches current Stripe state after its version fence and stores cancellation without authorizing access',async t=>{
 const h=await sqlHarness(t),store=load('src/server/public-subscription-store.ts'),s=stripe([subscription(),subscription({status:'canceled',cancel_at_period_end:true,canceled_at:1_900_000_000,ended_at:1_900_000_001})]);
 assert.equal(await store.syncSubscriptionEvent(h.api,s,event(),PRICE),'processed');assert.deepEqual(s.calls,[SUB,SUB]);
 const row=(await h.db.query('select status,cancel_at_period_end,canceled_at,ended_at,price_id from hood_subscription_snapshots')).rows[0];assert.equal(row.status,'canceled');assert.equal(row.cancel_at_period_end,true);assert.equal(Number(row.canceled_at),1_900_000_000);assert.equal(Number(row.ended_at),1_900_000_001);assert.equal(row.price_id,PRICE);
 assert.doesNotMatch(fs.readFileSync('src/server/public-services.ts','utf8'),/hood_subscription_snapshots/);
});
test('unknown events, unbound customers and unrelated prices are ignored without receipts',async t=>{
 const h=await sqlHarness(t),store=load('src/server/public-subscription-store.ts');
 assert.equal(await store.syncSubscriptionEvent(h.api,stripe([]),event('evt_unknown','invoice.paid'),PRICE),'ignored');
 assert.equal(await store.syncSubscriptionEvent(h.api,stripe([subscription({customer:'cus_unbound'})]),event('evt_unbound','customer.subscription.updated',{id:SUB,customer:'cus_unbound'}),PRICE),'ignored');
 assert.equal(await store.syncSubscriptionEvent(h.api,stripe([subscription({items:{data:[{price:{id:'price_other'},quantity:1,current_period_end:2_000_000_000}]}})]),event('evt_product'),PRICE),'ignored');
 assert.equal((await h.db.query('select count(*)::integer as n from hood_subscription_events')).rows[0].n,0);
});
test('wrong retrieved identity/customer and store outages fail for retry; failed events can later advance and complete',async t=>{
 const h=await sqlHarness(t),store=load('src/server/public-subscription-store.ts');
 await assert.rejects(store.syncSubscriptionEvent(h.api,stripe([subscription({id:'sub_other'})]),event('evt_identity'),PRICE),/subscription/i);
 await assert.rejects(store.syncSubscriptionEvent(h.api,stripe([subscription({customer:'cus_other'})]),event('evt_customer'),PRICE),/synchron/i);
 await assert.rejects(store.syncSubscriptionEvent(h.api,stripe([subscription(),new Error('inert Stripe outage')]),event('evt_retry'),PRICE));
 let receipt=(await h.db.query("select version,processed_at from hood_subscription_events where event_id='evt_retry'")).rows[0];assert.equal(Number(receipt.version),1);assert.equal(receipt.processed_at,null);
 assert.equal(await store.syncSubscriptionEvent(h.api,stripe([subscription(),subscription()]),event('evt_retry'),PRICE),'processed');receipt=(await h.db.query("select version,processed_at from hood_subscription_events where event_id='evt_retry'")).rows[0];assert.equal(Number(receipt.version),2);assert.ok(receipt.processed_at);
});
test('checkout completion accepts only subscription mode with bounded string IDs',async t=>{
 const h=await sqlHarness(t),store=load('src/server/public-subscription-store.ts'),checkout=event('evt_checkout','checkout.session.completed',{id:'cs_fixture',mode:'subscription',subscription:SUB,customer:CUSTOMER});
 assert.equal(await store.syncSubscriptionEvent(h.api,stripe([subscription(),subscription()]),checkout,PRICE),'processed');
 await assert.rejects(store.syncSubscriptionEvent(h.api,stripe([]),event('evt_mode','checkout.session.completed',{id:'cs_mode',mode:'payment',subscription:SUB,customer:CUSTOMER}),PRICE),/mode/i);
});
test('database completion outage leaves the receipt pending and retry gets a newer version',async t=>{
 const h=await sqlHarness(t),store=load('src/server/public-subscription-store.ts');let failComplete=true;
 const flaky={rpc:async(name,args)=>name==='hood_subscription_complete'&&failComplete?{data:null,error:{message:'inert DB outage'}}:h.api.rpc(name,args)};
 await assert.rejects(store.syncSubscriptionEvent(flaky,stripe([subscription(),subscription()]),event('evt_dbretry'),PRICE));
 let receipt=(await h.db.query("select version,processed_at from hood_subscription_events where event_id='evt_dbretry'")).rows[0];assert.equal(Number(receipt.version),1);assert.equal(receipt.processed_at,null);
 failComplete=false;assert.equal(await store.syncSubscriptionEvent(flaky,stripe([subscription(),subscription()]),event('evt_dbretry'),PRICE),'processed');
 receipt=(await h.db.query("select version,processed_at from hood_subscription_events where event_id='evt_dbretry'")).rows[0];assert.equal(Number(receipt.version),2);assert.ok(receipt.processed_at);
});
