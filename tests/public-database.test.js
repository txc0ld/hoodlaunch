const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('Postgres migration denies public data access and quota admission is atomic',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);");
 await db.exec(fs.readFileSync('db/001_public_services.sql','utf8'));
 await db.exec('set role anon');
 await assert.rejects(db.query('select * from public.hood_sessions'));
 await assert.rejects(db.query("select public.hood_take_quota('attack',1,60)"));
 await db.exec('reset role; set role service_role');
 const results=await Promise.all(Array.from({length:20},()=>db.query("select public.hood_take_quota('race',3,60) as admitted")));
 assert.equal(results.filter(x=>x.rows[0].admitted).length,3);
 const stored=await db.query("select used from public.hood_quota where bucket='race'");assert.equal(stored.rows[0].used,3);
 await db.exec('reset role');await db.query("insert into auth.users values('11111111-1111-1111-1111-111111111111')");
 await db.query("insert into public.hood_billing(user_id,customer_id) values('11111111-1111-1111-1111-111111111111','cus_test')");
 await db.exec('set role service_role');
 const keys=await Promise.all(Array.from({length:10},()=>db.query("select public.hood_checkout_key('11111111-1111-1111-1111-111111111111') as key")));
 assert.equal(new Set(keys.map(x=>x.rows[0].key)).size,1);assert.ok(keys[0].rows[0].key);
 await db.exec('reset role; set role authenticated');await assert.rejects(db.query("update public.hood_billing set customer_id='cus_stolen'"));
 }finally{await db.close();}
});
