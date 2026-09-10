const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('typescript'),ethers=require('ethers'),{PGlite}=require('@electric-sql/pglite'),{createRequire}=require('node:module');
const U='11111111-1111-1111-1111-111111111111',V='22222222-2222-2222-2222-222222222222';
const S='a'.repeat(64),T='b'.repeat(64),THRESHOLD=ethers.BigNumber.from('500000000000000000000000');
const wallet=ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk'); // Public inert test fixture only.
const other=ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk',"m/44'/60'/0'/0/1");
function load(file,mocks={},globals={}) {const filename=path.resolve(file),actual=createRequire(filename),module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=name=>Object.hasOwn(mocks,name)?mocks[name]:name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts'),mocks,globals):actual(name);
 vm.runInNewContext(code,{module,exports:module.exports,require:req,process,Buffer,URL,Date,console,setTimeout,clearTimeout,AbortSignal,...globals},{filename});return module.exports;}
async function harness(t){const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');
 await db.exec(fs.readFileSync('db/001_public_services.sql','utf8'));await db.exec(fs.readFileSync('db/002_holder_pro.sql','utf8'));
 await db.query('insert into auth.users values($1),($2)',[U,V]);await db.query("insert into hood_sessions values($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",[S,U,T,V]);await db.exec('set role service_role');
 const calls=[],controls={balance:THRESHOLD},oldOrigin=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://launch.example.test';let now=Date.now(),blockReads=0,headReads=0;
 class Clock extends Date{static now(){return now;}}
 class Provider{constructor(connection){assert.equal(connection.url,'https://rpc.mainnet.chain.robinhood.com');assert.equal(connection.timeout,12000);blockReads=0;headReads=0;}
  async send(method){calls.push(method);assert.equal(method,'eth_chainId');if(controls.rpcFailure)throw Error('inert RPC outage');return controls.wrongChain?'0x1':'0x1237';}
  async getBlockNumber(){return controls.shortHead || (controls.dropHead && ++headReads>1)?99:100;}
  async getBlock(n){assert.equal(n,controls.shortHead?98:99);return {number:n,hash:'0x'+(controls.reorg && ++blockReads>1?'bb':'aa').repeat(32)};}
  async getCode(address,n){assert.ok([98,99].includes(n));return address.toLowerCase()==='0x6d5dc12131b2ad8748c54ab1ac1b1a2cc53c2118'?(controls.noToken?'0x':'0x6000'):(controls.contractWallet?'0xef0100'+'12'.repeat(20):'0x');}
  removeAllListeners(){}
 }
 class Contract{constructor(address){assert.equal(ethers.utils.getAddress(address),ethers.utils.getAddress('0x6d5dc12131b2ad8748c54ab1ac1b1a2cc53c2118'));}
  async decimals(opts){assert.ok([98,99].includes(opts.blockTag));return controls.wrongDecimals?6:18;}
  async balanceOf(address,opts){assert.ok([98,99].includes(opts.blockTag));if(controls.onBalance)await controls.onBalance();return controls.balance;}
 }
 const database={rpc:async(name,args)=>{calls.push(name);if(controls.dbFailure)return {data:null,error:{message:'inert DB failure'}};assert.match(name,/^hood_holder_(context|challenge|read_challenge|consume|unlink)$/);
  const entries=Object.entries(args);try{const row=await db.query(`select public.${name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) as result`,entries.map(([,value])=>value));return {data:row.rows[0].result,error:null};}catch(error){return {data:null,error};}}};
 const mocks={ethers:{...ethers,Contract,providers:{JsonRpcProvider:Provider}}};const holder=load('src/server/public-holder.ts',mocks,{Date:Clock});
 t.after(async()=>{if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;await db.close();});
 return {db,database,holder,calls,controls,advance:ms=>{now+=ms;},challenge:(who=U,session=S,address=wallet.address)=>holder.holderChallenge(database,who,session,address),verify:(c,sig,who=U,session=S)=>holder.verifyHolder(database,who,session,c.challengeId,sig),access:(who=U,session=S)=>holder.holderAccess(database,who,session)};
}
async function prove(h){const c=await h.challenge();await h.verify(c,await wallet.signMessage(c.message));return c;}
test('real inert EIP191 proof is session-bound and the threshold is exact, inclusive and freshly checked',async t=>{
 const h=await harness(t),c=await prove(h);assert.match(c.message,/Chain ID: 4663/);assert.match(c.message,new RegExp(S));assert.match(c.message,/does not authorize transactions or token approvals/);
 for(const [amount,eligible] of [[THRESHOLD.sub(1),false],[THRESHOLD,true],[THRESHOLD.add(1),true],[ethers.constants.Zero,false]]){h.controls.balance=amount;const status=await h.access();assert.equal(status.eligible,eligible);assert.equal(status.balance,amount.toString());assert.equal(status.verified,true);}
 assert.ok(h.calls.filter(x=>x.startsWith('eth_')).every(x=>x==='eth_chainId'));
});
test('wrong user/session/domain/chain/message/address and malformed signatures never bind a wallet',async t=>{
 const h=await harness(t),c=await h.challenge();await assert.rejects(()=>h.verify(c,'0x00'));
 const sig=await wallet.signMessage(c.message);await assert.rejects(()=>h.verify(c,sig,V,T));await assert.rejects(()=>h.verify(c,sig,U,T));
 for(const changed of [c.message.replace('launch.example.test','evil.example.test'),c.message.replace('Chain ID: 4663','Chain ID: 1'),c.message+' extra',c.message.replace(wallet.address,other.address)])await assert.rejects(async()=>h.verify(c,await wallet.signMessage(changed)));
 const wrongSigner=await other.signMessage(c.message);await assert.rejects(()=>h.verify(c,wrongSigner));
 process.env.APP_ORIGIN='https://different.example.test';await assert.rejects(()=>h.verify(c,sig));process.env.APP_ORIGIN='https://launch.example.test';
 assert.equal((await h.access()).verified,false);assert.equal((await h.db.query('select * from hood_holder_wallets')).rows.length,0);
});
test('concurrent consumption admits exactly one signature and replay cannot refresh authority',async t=>{
 const h=await harness(t),c=await h.challenge(),sig=await wallet.signMessage(c.message);const outcomes=await Promise.allSettled([h.verify(c,sig),h.verify(c,sig),h.verify(c,sig)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);await assert.rejects(()=>h.verify(c,sig));assert.equal((await h.db.query('select consumed from hood_holder_challenges')).rows[0].consumed,true);
});
test('fresh login needs a fresh proof; logout during verification removes the challenge and prevents binding',async t=>{
 const h=await harness(t);await prove(h);const anotherSession='c'.repeat(64);await h.db.query("insert into hood_sessions values($1,$2,now()+interval '1 hour')",[anotherSession,U]);assert.equal((await h.access(U,anotherSession)).verified,false);
 const c=await h.challenge(U,anotherSession),sig=await wallet.signMessage(c.message);h.controls.onBalance=async()=>{await h.db.query('delete from hood_sessions where token_hash=$1',[anotherSession]);};await assert.rejects(()=>h.verify(c,sig,U,anotherSession));
 assert.equal((await h.db.query('select * from hood_holder_proofs where session_hash=$1',[anotherSession])).rows.length,0);
});
test('five-minute challenge expiry and session expiry during RPC fail before consume',async t=>{
 const h=await harness(t),c=await h.challenge(),sig=await wallet.signMessage(c.message);h.advance(300000);await assert.rejects(()=>h.verify(c,sig));assert.equal((await h.db.query('select * from hood_holder_proofs')).rows.length,0);
 const j=await harness(t),d=await j.challenge(),signature=await wallet.signMessage(d.message);j.controls.onBalance=async()=>{await j.db.query("update hood_sessions set expires_at=now()-interval '1 second' where token_hash=$1",[S]);};await assert.rejects(()=>j.verify(d,signature));
});
test('one wallet belongs to one account; replacement needs unlink, which invalidates all proofs and pending challenges',async t=>{
 const h=await harness(t);await prove(h);const foreign=await h.challenge(V,T);await assert.rejects(async()=>h.verify(foreign,await wallet.signMessage(foreign.message),V,T));
 await assert.rejects(()=>h.challenge(U,S,other.address));const pending=await h.challenge();await h.holder.unlinkHolder(h.database,U,S);await assert.rejects(async()=>h.verify(pending,await wallet.signMessage(pending.message)));
 assert.equal((await h.access()).address,null);const c=await h.challenge(U,S,other.address);await h.verify(c,await other.signMessage(c.message));assert.equal((await h.access()).address,other.address.toLowerCase());
});
test('contract/delegated wallets, wrong chain/decimals, missing token and reorg never prove holder access',async t=>{
 const h=await harness(t),c=await h.challenge(),sig=await wallet.signMessage(c.message);
 for(const flag of ['contractWallet','wrongChain','wrongDecimals','noToken','reorg','dropHead','rpcFailure']){h.controls[flag]=true;await assert.rejects(()=>h.verify(c,sig));delete h.controls[flag];}
 await h.verify(c,sig);for(const flag of ['contractWallet','wrongChain','wrongDecimals','noToken','reorg','dropHead','rpcFailure']){h.controls[flag]=true;const result=await h.access();assert.equal(result.eligible,false);assert.equal(result.unavailable,true);delete h.controls[flag];}
});
test('unlink during balance read revokes authority before it can be returned',async t=>{
 const h=await harness(t);await prove(h);h.controls.onBalance=async()=>h.holder.unlinkHolder(h.database,U,S);const result=await h.access();assert.equal(result.eligible,false);assert.equal(result.verified,false);
});
test('SQL denies anonymous direct proof, mutation and read access',async t=>{
 const h=await harness(t);await h.db.exec('reset role;set role anon');await assert.rejects(h.db.query('select * from hood_holder_wallets'));await assert.rejects(h.db.query('select public.hood_holder_context($1,$2)',[U,S]));await assert.rejects(h.db.query('select public.hood_holder_unlink($1,$2)',[U,S]));
});
test('Stripe and holder eligibility are independent OR branches, including either provider outage',async t=>{
 const names=['APP_ORIGIN','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','STRIPE_SECRET_KEY','STRIPE_PRO_PRICE_ID'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{APP_ORIGIN:'https://launch.example.test',SUPABASE_URL:'https://inert.supabase.test',SUPABASE_ANON_KEY:'inert-anon',SUPABASE_SERVICE_ROLE_KEY:'inert-service',STRIPE_SECRET_KEY:'sk_test_inert',STRIPE_PRO_PRICE_ID:'price_fixed'});
 t.after(()=>{for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}});
 const state={subscription:false,holder:false,stripeFail:false,holderFail:false};
 class Stripe{constructor(){this.subscriptions={list:async()=>{if(state.stripeFail)throw Error('inert Stripe outage');return {data:state.subscription?[{customer:'cus_test',status:'active',items:{data:[{quantity:1,price:{id:'price_fixed'},current_period_end:Math.floor(Date.now()/1000)+1000}]}}]:[]};}};}}
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{customer_id:'cus_test'},error:null})})})})};
 const svc=load('src/server/public-services.ts',{'@supabase/supabase-js':{createClient:()=>db},stripe:Stripe,'./public-holder':{holderAccess:async()=>{if(state.holderFail)throw Error('inert holder outage');return {address:wallet.address,verified:state.holder,eligible:state.holder,balance:null,unavailable:false};}}});
 for(const [subscription,holder,stripeFail,holderFail,expected] of [[true,false,false,true,true],[false,true,true,false,true],[true,true,false,false,true],[false,false,false,false,false],[false,false,true,false,false],[false,false,false,true,false]]){
  Object.assign(state,{subscription,holder,stripeFail,holderFail});const status=await svc.getProStatus(U,S);assert.equal(status.pro,expected);assert.equal(status.subscriptionUnavailable,stripeFail);assert.equal(status.holder.unavailable,holderFail);
  if(!expected && (stripeFail || holderFail))await assert.rejects(()=>svc.hasPro(U,S),e=>e.status===503);else assert.equal(await svc.hasPro(U,S),expected);
 }
});
test('checkout routing uses paid subscription only, while holder API actions authenticate and bind server session',async t=>{
 const {PassThrough}=require('node:stream');const oldOrigin=process.env.APP_ORIGIN,oldLive=process.env.LIVE_LAUNCH_ENABLED;process.env.APP_ORIGIN='https://launch.example.test';process.env.LIVE_LAUNCH_ENABLED='true';
 t.after(()=>{if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;if(oldLive===undefined)delete process.env.LIVE_LAUNCH_ENABLED;else process.env.LIVE_LAUNCH_ENABLED=oldLive;});
 let paid=false,authenticated=true;const calls=[];
 const svc={account:async()=>{if(!authenticated)throw Error('unauthenticated');return U;},takeQuota:async(key,limit,seconds)=>calls.push({quota:key,limit,seconds}),stripeClient:()=>({}),customerFor:async()=> 'cus_test',database:()=>({}),hasSubscription:async()=>paid,getProStatus:async()=>{throw Error('combined status must not route checkout');}};
 const holder={holderChallenge:async(db,user,session,address)=>{calls.push({user,session,address});return {challengeId:'fixture',message:'fixture',address,chainId:4663};},verifyHolder:async()=>calls.push('verified'),unlinkHolder:async()=>calls.push('unlinked')};
 const route=load('pages/api/account.ts',{'../../src/server/public-services':svc,'../../src/server/public-holder':holder,'../../src/server/public-checkout':{subscriptionCheckout:async()=>{calls.push('checkout');return 'https://checkout.stripe.com/mock';},billingPortal:async()=>{calls.push('portal');return 'https://billing.stripe.com/mock';}}}).default;
 function req(body){const r=new PassThrough();r.method='POST';r.headers={origin:process.env.APP_ORIGIN,'content-type':'application/json',cookie:(process.env.NODE_ENV==='production'?'__Host-hood-session=':'hood-session=')+'d'.repeat(64)};r.rawHeaders=['Origin',process.env.APP_ORIGIN];process.nextTick(()=>r.end(JSON.stringify(body)));return r;}
 function res(){return {code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};}
 let response=res();await route(req({action:'checkout',pro:true}),response);assert.equal(response.code,200);assert.ok(calls.includes('checkout'));assert.ok(!calls.includes('portal'));
 paid=true;response=res();await route(req({action:'checkout'}),response);assert.ok(calls.includes('portal'));
 response=res();await route(req({action:'holder-challenge',address:wallet.address,userId:V,sessionHash:T}),response);assert.equal(response.code,200);const linked=calls.find(x=>x && typeof x==='object' && x.user);assert.equal(linked.user,U);assert.equal(linked.session,crypto.createHash('sha256').update('d'.repeat(64)).digest('hex'));
 for(const action of ['holder-verify','holder-unlink']){response=res();await route(req({action,challengeId:'fixture',signature:'fixture'}),response);assert.equal(response.code,200);}
 for(const [action,limit] of [['holder-challenge',10],['holder-verify',20],['holder-unlink',10]]){const quota=calls.find(x=>x && x.quota===action+':'+U);assert.equal(quota.limit,limit);assert.equal(quota.seconds,900);}
 authenticated=false;const count=calls.length;response=res();await route(req({action:'holder-unlink'}),response);assert.notEqual(response.code,200);assert.equal(calls.length,count);
});
test('SQL live session expiry is evaluated after waits, not at transaction start',async t=>{
 const h=await harness(t);await h.db.exec('begin');
 try {await h.db.query("update hood_sessions set expires_at=clock_timestamp()+interval '0.05 seconds' where token_hash=$1",[S]);await h.db.query('select pg_sleep(0.08)');await assert.rejects(h.db.query('select public.hood_holder_context($1,$2)',[U,S]),/session expired/);}finally{await h.db.exec('rollback');}
});
test('SQL consume rejects nonce expiry while a transaction is already open and rolls back its binding',async t=>{
 const h=await harness(t),c=await h.challenge();await h.db.exec('begin');
 try {await h.db.query("update hood_holder_challenges set expires_at=clock_timestamp()+interval '0.05 seconds' where id=$1",[c.challengeId]);await h.db.query('select pg_sleep(0.08)');await assert.rejects(h.db.query('select public.hood_holder_consume($1,$2,$3,$4,$5)',[U,S,c.challengeId,wallet.address.toLowerCase(),c.message]),/challenge unavailable/);}finally{await h.db.exec('rollback');}
 assert.equal((await h.db.query('select * from hood_holder_proofs')).rows.length,0);
});
test('SQL null or mismatched verified payload cannot consume a valid challenge',async t=>{
 const h=await harness(t),c=await h.challenge();
 for(const [address,message] of [[wallet.address.toLowerCase(),null],[null,c.message],[other.address.toLowerCase(),c.message],[wallet.address.toLowerCase(),c.message+'changed']]){
  await assert.rejects(h.db.query('select public.hood_holder_consume($1,$2,$3,$4,$5)',[U,S,c.challengeId,address,message]));
 }
 assert.equal((await h.db.query('select consumed from hood_holder_challenges where id=$1',[c.challengeId])).rows[0].consumed,false);assert.equal((await h.db.query('select * from hood_holder_proofs')).rows.length,0);
});
