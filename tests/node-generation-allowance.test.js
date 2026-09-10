const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{PassThrough}=require('node:stream'),ts=require('typescript'),{PGlite}=require('@electric-sql/pglite');
const user='11111111-1111-1111-1111-111111111111',other='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333',token='a'.repeat(64),session='b'.repeat(64);
test('allowance migration provides service-only atomic cooldown, idempotence and account isolation',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');
  for(const f of ['001_public_services.sql','002_holder_pro.sql','004_node_generation.sql'])await db.exec(fs.readFileSync('db/'+f,'utf8'));
  await db.query('insert into auth.users values($1),($2)',[user,other]);
  await db.query("insert into hood_sessions values($1,$2,clock_timestamp()+interval '1 hour'),($3,$4,clock_timestamp()+interval '1 hour')",[token,user,session,other]);
  await db.exec('set role anon');await assert.rejects(db.query('select * from hood_node_attempts'));await assert.rejects(db.query('select hood_node_generation_status($1,$2)',[user,token]));
  await db.exec('reset role;set role authenticated');await assert.rejects(db.query('select * from hood_node_cooldowns'));
  await db.exec('reset role;set role service_role');
  const reserve=async(u,s,id,count=1,pro=false)=>(await db.query('select hood_node_generation_reserve($1,$2,$3,$4,$5,null,null,$5,clock_timestamp()) as result',[u,s,id,count,pro])).rows[0].result;
  const first=await reserve(user,token,requestId);assert.equal(first.reserved,true);assert.equal(first.count,1);assert.equal(Date.parse(first.nextEligibleAt)-Date.parse(first.reservedAt),86400000);
  const repeats=await Promise.all(Array.from({length:10},()=>reserve(user,token,requestId)));assert.ok(repeats.every(x=>JSON.stringify(x)===JSON.stringify(first)));
  const outcomes=await Promise.all(Array.from({length:10},(_,i)=>reserve(user,token,`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`)));assert.ok(outcomes.every(x=>x.reserved===false));
  await assert.rejects(reserve(user,token,requestId,2,true),/conflict/);
  assert.equal((await reserve(user,token,other,2,false)).code,'PRO_REQUIRED');
  await assert.rejects(reserve(user,token,other,51,true),/invalid generation/);
  assert.equal((await reserve(other,session,requestId)).reserved,true);
  await assert.rejects(reserve(other,token,other));
  const bulk=await reserve(user,token,other,50,true);assert.equal(bulk.count,50);assert.deepEqual(await reserve(user,token,other,50,false),bulk);
  const address='0x1111111111111111111111111111111111111111',proof='77777777-7777-4777-8777-777777777777';
  await db.query('insert into hood_holder_wallets(user_id,address) values($1,$2)',[other,address]);
  await db.query('insert into hood_holder_proofs(session_hash,user_id,address,proof_id) values($1,$2,$3,$4)',[session,other,address,proof]);
  const stamped=async(id,count,subscription=false,age='0 seconds')=>(await db.query("select hood_node_generation_reserve($1,$2,$3,$4,true,$5,$6,$7,clock_timestamp()-$8::interval) as result",[other,session,id,count,proof,address,subscription,age])).rows[0].result;
  const granted=await stamped('88888888-8888-4888-8888-888888888888',50);assert.equal(granted.reserved,true);
  await db.query('select hood_holder_unlink($1,$2)',[other,session]);
  assert.deepEqual(await stamped('88888888-8888-4888-8888-888888888888',50),granted);
  assert.equal((await stamped('99999999-9999-4999-8999-999999999999',50)).code,'PRO_REQUIRED');
  assert.equal((await stamped('99999999-9999-4999-8999-999999999999',1)).reserved,false);
  for(const age of ['16 seconds','-6 seconds']){
    assert.equal((await stamped('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',50,true,age)).code,'PRO_REQUIRED');
    assert.equal((await stamped('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,true,age)).reserved,false);
  }
  assert.equal((await stamped('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',50,true)).reserved,true);
  await db.query("update hood_node_cooldowns set next_eligible_at=clock_timestamp() where user_id=$1",[user]);
  assert.equal((await reserve(user,token,'55555555-5555-4555-8555-555555555555')).reserved,true);
  const before=(await db.query('select count(*)::int as n from hood_node_attempts')).rows[0].n;
  await db.query('delete from hood_sessions where user_id=$1',[user]);
  await assert.rejects(reserve(user,token,'66666666-6666-4666-8666-666666666666'));
  assert.equal((await db.query('select count(*)::int as n from hood_node_attempts')).rows[0].n,before);
 }finally{await db.close();}
});
function load(file,mocks={}){
 const filename=path.resolve(file),m={exports:{}},actual=createRequire(filename);
 const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(compiled,{module:m,exports:m.exports,require:n=>Object.hasOwn(mocks,n)?mocks[n]:actual(n),process,Buffer,URL,setTimeout,clearTimeout});return m.exports;
}
const security=load('src/server/public-security.ts');
function req(body){const r=new PassThrough();r.method='POST';r.rawHeaders=['Origin','https://test.example'];r.headers={origin:'https://test.example','content-type':'application/json',cookie:`${security.cookieName()}=${token}`};process.nextTick(()=>r.end(JSON.stringify(body)));return r;}
function res(){return {statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.body=value;}};}
test('generation route enforces closed flag, identity, free count and unknown results',async()=>{
 const old=process.env.APP_ORIGIN,flag=process.env.NODE_GENERATION_ENABLED;process.env.APP_ORIGIN='https://test.example';
 let calls=0,pro=false,reply={data:{reserved:true,requestId,count:1,reservedAt:'2026-09-11T00:00:00Z',nextEligibleAt:'2026-09-12T00:00:00Z'},error:null};
 const handler=security.safeHandler(load('src/server/public-node-generation.ts',{'./public-security':security,'./public-services':{account:async()=>{calls++;return user;},takeQuota:async()=>{},getProStatus:async()=>({pro,subscription:pro}),database:()=>({rpc:async(name,args)=>{assert.equal(args.p_user,user);assert.equal(args.p_session,security.digest(token));if(name==='hood_holder_context')return {data:{address:null,proof_id:null},error:null};if(name.endsWith('reserve')){assert.equal(args.p_pro,pro);if(!pro&&args.p_count===2)return {data:{reserved:false,code:'PRO_REQUIRED'},error:null};}return reply;}})}}).handleNodeGeneration);
 try{
  for(const value of [undefined,'false','TRUE',' true ']){if(value===undefined)delete process.env.NODE_GENERATION_ENABLED;else process.env.NODE_GENERATION_ENABLED=value;const r=res();await handler(req({action:'reserve',requestId,count:1}),r);assert.equal(r.statusCode,503);assert.equal(calls,0);}
  process.env.NODE_GENERATION_ENABLED='true';
  for(const body of [{action:'reserve',requestId,count:1,pro:true},{action:'reserve',requestId,count:1,privateKey:'never accepted'},{action:'reserve',requestId,count:0},{action:'reserve',requestId,count:1.1},{action:'reserve',requestId:'bad',count:1},{action:{}}]){const r=res();await handler(req(body),r);assert.equal(r.statusCode,400);}
  let r=res();await handler(req({action:'reserve',requestId,count:2}),r);assert.equal(r.statusCode,403);
  r=res();await handler(req({action:'reserve',requestId,count:1}),r);assert.equal(r.statusCode,200);assert.equal(r.body.count,1);
  reply={data:{reserved:false,nextEligibleAt:'2026-09-12T00:00:00Z'},error:null};r=res();await handler(req({action:'reserve',requestId,count:1}),r);assert.equal(r.statusCode,429);
  for(const data of [null,{reserved:true,count:1,requestId:'wrong'},{reserved:false,nextEligibleAt:'bad'}]){reply={data,error:null};r=res();await handler(req({action:'reserve',requestId,count:1}),r);assert.equal(r.statusCode,503);}
 }finally{if(old===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=old;if(flag===undefined)delete process.env.NODE_GENERATION_ENABLED;else process.env.NODE_GENERATION_ENABLED=flag;}
});
