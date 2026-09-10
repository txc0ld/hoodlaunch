const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{randomUUID}=require('node:crypto'),ts=require('typescript'),{Wallet,utils}=require('ethers');
function load(file,mocks={},globals={}) {
 const filename=path.resolve(file),m={exports:{}},native=createRequire(filename);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const req=n=>Object.hasOwn(mocks,n)?mocks[n]:n.startsWith('.')?load(path.resolve(path.dirname(filename),n+'.ts'),mocks,globals):native(n);
 vm.runInNewContext(code,{module:m,exports:m.exports,require:req,process,URL,Buffer,setTimeout,clearTimeout,...globals},{filename});return m.exports;
}
const site='https://labs.hoodrich.rip',signer=new Wallet('0x'+'29'.repeat(32)),uid='11111111-1111-4111-8111-111111111111'; // inert public test key, never funded
const message=load('src/lib/wallet-signin-message.ts');
function challenge(id=randomUUID()) {const now=Date.now(),d={challengeId:id,address:signer.address,nonce:'a'.repeat(32),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),notBefore:new Date(now-30000).toISOString()};return {...d,message:message.signInMessage(site,d)};}
function clientFixture(){
 const stored=new Map(),listeners=new Map(),calls=[],providerCalls=[];
 const storage={get length(){return stored.size;},key:i=>[...stored.keys()][i]??null,getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 const window={localStorage:storage,dispatchEvent(){}};
 const client=load('src/lib/wallet-signin.ts',{}, {window,Event:class Event{},crypto:{randomUUID}});
 let active=true,address=signer.address,chain='0x1237';
 const wallet={on:(event,cb)=>listeners.set(event,cb),removeListener:(event,cb)=>{assert.equal(listeners.get(event),cb);listeners.delete(event);},request:async input=>{providerCalls.push(input.method);if(input.method==='eth_requestAccounts'||input.method==='eth_accounts')return [address];if(input.method==='eth_chainId')return chain;if(input.method==='personal_sign')return signer.signMessage(utils.arrayify(input.params[0]));throw Error('unexpected financial method');}};
 const request=async(action,data)=>{calls.push({action,data});if(action==='auth-prepare')return{prepared:true};if(action==='wallet-signin-challenge')return challenge(data.requestId);if(action==='wallet-signin-verify')return{signedIn:true};if(action==='auth-cancel')return{canceled:true};throw Error('unknown action');};
 return {client,stored,storage,wallet,request,calls,providerCalls,listeners,current:()=>{if(!active)throw Error('closed');},close:()=>{active=false;},setChain:v=>{chain=v;},setAddress:v=>{address=v;}};
}
test('wallet sign-in signs one fixed ownership message, clears intent on guarded success, never transacts',async()=>{
 const f=clientFixture();await f.client.signInWithWallet(f.wallet,site,f.request,f.current,()=>{});
 assert.deepEqual(f.calls.map(c=>c.action),['auth-prepare','wallet-signin-challenge','wallet-signin-verify']);
 assert.equal(f.providerCalls.filter(c=>c==='personal_sign').length,1);assert.equal(f.stored.size,0);assert.equal(f.listeners.size,0);
 assert.deepEqual(Object.keys(f.calls[2].data).sort(),['challengeId','signature']);
});
for(const field of ['message','address','expiresAt','challengeId'])test(`wrong challenge ${field} refused before signing`,async()=>{
 const f=clientFixture();const req=async(...args)=>{const value=await f.request(...args);if(args[0]==='wallet-signin-challenge')value[field]='wrong';return value;};
 await assert.rejects(f.client.signInWithWallet(f.wallet,site,req,f.current,()=>{}));assert.ok(!f.providerCalls.includes('personal_sign'));assert.equal(f.calls.at(-1).action,'auth-cancel');assert.equal(f.stored.size,0);
});
for(const phase of ['auth-prepare','wallet-signin-challenge','wallet-signin-verify'])for(const change of ['close','chain','address'])test(`${change} during ${phase} cancels and never adopts`,async()=>{
 const f=clientFixture();const req=async(...args)=>{const result=await f.request(...args);if(args[0]===phase){if(change==='close')f.close();if(change==='chain')f.setChain('0x1');if(change==='address')f.setAddress('0x'+'11'.repeat(20));}return result;};
 await assert.rejects(f.client.signInWithWallet(f.wallet,site,req,f.current,()=>{}));assert.equal(f.calls.at(-1).action,'auth-cancel');assert.equal(f.stored.size,0);
});
for(const event of ['accountsChanged','chainChanged','disconnect'])test(`${event} during signing cancels transient changes`,async()=>{
 const f=clientFixture(),old=f.wallet.request;f.wallet.request=async input=>{const result=await old(input);if(input.method==='personal_sign')f.listeners.get(event)();return result;};
 await assert.rejects(f.client.signInWithWallet(f.wallet,site,f.request,f.current,()=>{}));assert.equal(f.calls.some(c=>c.action==='wallet-signin-verify'),false);assert.equal(f.stored.size,0);
});
test('lost begin response and cancellation failure retain only revocation ID through remount',async()=>{
 const f=clientFixture(),req=async(action,data)=>{if(action==='wallet-signin-challenge'||action==='auth-cancel')throw Error('network');return f.request(action,data);};
 await assert.rejects(f.client.signInWithWallet(f.wallet,site,req,f.current,()=>{}),/unknown/);
 assert.equal(f.stored.size,1);assert.ok([...f.stored.values()].every(v=>v==='pending'));assert.throws(()=>f.client.startClientAuth(),/cancellation/);
 await f.client.cancelPendingAuth(f.request);assert.equal(f.stored.size,0);
});
test('storage denied refuses sign-in before provider challenge or signature',async()=>{
 const f=clientFixture();f.storage.setItem=()=>{throw Error('denied');};
 await assert.rejects(f.client.signInWithWallet(f.wallet,site,f.request,f.current,()=>{}),/storage/);
 assert.equal(f.calls.length,0);assert.ok(!f.providerCalls.includes('personal_sign'));
});
test('concurrent tab intent is detected synchronously before successful adoption',async()=>{
 const f=clientFixture(),req=async(...args)=>{const value=await f.request(...args);if(args[0]==='wallet-signin-verify')f.stored.set('hoodlabs:pending-signin:'+randomUUID(),'pending');return value;};
 await assert.rejects(f.client.signInWithWallet(f.wallet,site,req,f.current,()=>{}));assert.equal(f.stored.size,1);assert.equal(f.calls.at(-1).action,'auth-cancel');
});
const oldOrigin=process.env.APP_ORIGIN;process.env.APP_ORIGIN=site;test.after(()=>{if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;});
const security=load('src/server/public-security.ts');
function server(services={}){return load('src/server/public-wallet-signin.ts',{'./public-services':{...services},'./public-security':security});}
function nativeData(){return{user:{id:uid,identities:[{provider:'web3',user_id:uid,identity_data:{address:signer.address,chain:'ethereum',network:4663,domain:new URL(site).host}}]},session:{user:{id:uid}}};}
test('native authority requires exact provider identity and UUID consistency, not user metadata',()=>{
 const s=server();assert.equal(s.nativeWalletUser(nativeData(),signer.address),uid);
 for(const [key,value] of [['address','0x'+'11'.repeat(20)],['chain','solana'],['network','4663'],['network',1],['domain','attacker.test']]){const data=nativeData();data.user.identities[0].identity_data[key]=value;assert.throws(()=>s.nativeWalletUser(data,signer.address));}
 for(const mutate of [d=>d.user.identities[0].provider='email',d=>d.user.identities[0].user_id=randomUUID(),d=>d.session.user.id=randomUUID(),d=>d.user.identities=[],d=>{d.user.user_metadata=d.user.identities[0].identity_data;delete d.user.identities;}]){const data=nativeData();mutate(data);assert.throws(()=>s.nativeWalletUser(data,signer.address));}
});
test('binding bootstrap preserves existing cookies, rejects duplicates, and exposes no binding secret in data',()=>{
 const s=server(),headers={'Set-Cookie':'existing=value'},res={getHeader:n=>headers[n],setHeader:(n,v)=>headers[n]=v};
 s.prepareAuthBinding({headers:{}},res);assert.equal(headers['Set-Cookie'][0],'existing=value');assert.match(headers['Set-Cookie'][1],/HttpOnly; SameSite=Strict; Max-Age=7200/);
 const name=s.bindingCookieName(),cookie=`${name}=${'a'.repeat(64)}`;
 assert.equal(s.readAuthBinding({headers:{cookie}}),security.digest('a'.repeat(64)));
 for(const cookie of [`${name}=bad`,`${name}=${'a'.repeat(64)}; ${name}=${'b'.repeat(64)}`])assert.throws(()=>s.readAuthBinding({headers:{cookie}}));
});
test('server claims only once and validates signature before native provider; unknown provider outcome cannot finish',async()=>{
 const d=challenge(),sKey='a'.repeat(64);let claimed=false,providerCalls=0,finishCalls=0;
 const s=server({takeQuota:async()=>{},database:()=>({rpc:async(_,args)=>{if(args.p_action==='claim'){if(claimed)return{data:null};claimed=true;return{data:d};}if(args.p_action==='finish'){finishCalls++;return{data:{signedIn:true}};}}}),authClient:()=>({auth:{signInWithWeb3:async()=>{providerCalls++;throw Error('timeout');}}})});
 const flag=process.env.WALLET_SIGNIN_ENABLED;process.env.WALLET_SIGNIN_ENABLED='true';
 try{
  const req={headers:{cookie:`${s.bindingCookieName()}=${sKey}`}},body={action:'wallet-signin-verify',challengeId:d.challengeId,signature:await signer.signMessage(d.message)};
  await assert.rejects(s.verifyWalletSignIn(req,{},body));await assert.rejects(s.verifyWalletSignIn(req,{},body));assert.equal(providerCalls,1);assert.equal(finishCalls,0);
  claimed=false;body.signature=await signer.signMessage('different');await assert.rejects(s.verifyWalletSignIn(req,{},body));assert.equal(providerCalls,1);
 }finally{if(flag===undefined)delete process.env.WALLET_SIGNIN_ENABLED;else process.env.WALLET_SIGNIN_ENABLED=flag;}
});
