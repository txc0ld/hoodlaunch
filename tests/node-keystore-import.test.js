const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),ethers=require('ethers');
const source=ts.transpileModule(fs.readFileSync('src/lib/node-vault.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const PASSWORD='Disposable shared test password';
const SAFE='Unable to import encrypted keystores. Check the files and shared password.';
function harness(options={}) {
 const stats={decrypts:0,active:0,maxActive:0,signs:0,returned:0,prepared:[]};
 class Clock extends Date{static now(){return options.now??Date.now();}}
 class Wallet extends ethers.Wallet {
  static async fromEncryptedJson(input,password,progress){
   stats.decrypts++;stats.active++;stats.maxActive=Math.max(stats.maxActive,stats.active);
   try{return options.decrypt?await options.decrypt(input,password,progress):await ethers.Wallet.fromEncryptedJson(input,password,progress);}finally{stats.active--;}
  }
  async signTransaction(tx){stats.signs++;const raw=await super.signTransaction(tx);options.afterSign?.();return raw;}
 }
 const tx={to:'0x1111111111111111111111111111111111111111',value:0,nonce:0,gasLimit:21000,gasPrice:1,chainId:4663};
 async function execute(session,review,active,sign){active();await options.beforeSign?.();active();const raw=await sign(tx);active();stats.returned++;return {raw};}
 const mocks={ethers:{...ethers,Wallet},'./pons-trade':{copyTradeAmount:x=>x},'./node-trading':{prepareTrade:async(s,i,address)=>{stats.prepared.push(address);return {nodeIndex:i,nodeAddress:address};},executeTrade:execute},'./relay-bridge':{prepareRelayBridge:async(s,i,address)=>{stats.prepared.push(address);return {nodeIndex:i,nodeAddress:address};},executeRelayBridge:execute}};
 const out={};new Function('exports','require','Date',source)(out,id=>{assert.ok(id in mocks,'Unexpected dependency');return mocks[id];},Clock);
 return {v:out,stats,Wallet};
}
const main=harness();let hd,files,addresses,fixtureWallets;
test.before(async()=>{
 hd=main.v.createNodeSession(5);addresses=[...hd.addresses];files=[];fixtureWallets=[];
 for(let i=0;i<5;i++){
  const serialized=await main.v.exportNodeKeystore(hd,i,PASSWORD);files.push(serialized);
  fixtureWallets.push(await ethers.Wallet.fromEncryptedJson(serialized,PASSWORD));
 }
});
test.after(()=>main.v.forgetNodeSession(hd));
test('five exact exported keystores recover ordered identities and re-export standard encrypted individuals',async()=>{
 const progress=[],order=[4,0,3,1,2];const s=await main.v.importNodeKeystores(order.map(i=>files[i]),PASSWORD,p=>{progress.push(p);return true;});
 assert.deepEqual(s.addresses,order.map(i=>addresses[i]));assert.equal(s.backupVerified,true);assert.ok(Object.isFrozen(s)&&Object.isFrozen(s.addresses));
 assert.deepEqual(Object.keys(s).sort(),['addresses','backupVerified','id']);
 assert.ok(progress.length>5&&progress.every((p,i)=>p>=0&&p<=1&&(!i||p>=progress[i-1])));assert.equal(progress.at(-1),1);
 for(let i=0;i<5;i++){
  const exported=await main.v.exportNodeKeystore(s,i,'Different disposable password');
  assert.deepEqual(Object.keys(JSON.parse(exported)).sort(),['address','crypto','id','version']);
  assert.equal((await ethers.Wallet.fromEncryptedJson(exported,'Different disposable password')).address,s.addresses[i]);
 }
 await assert.rejects(main.v.encryptNodeBackup(s,PASSWORD),{message:'Use the original encrypted keystore files to restore these imported wallets.'});
 main.v.forgetNodeSession(s);assert.equal(main.v.isVerifiedNodeSession(s),false);await assert.rejects(main.v.exportNodeKeystore(s,0,PASSWORD),/no longer available/);
});
function changed(mutate){const value=JSON.parse(files[0]);mutate(value);return JSON.stringify(value);}
test('all count, format, byte, cost, unknown-field and duplicate checks precede any decryption',async()=>{
 const h=harness({decrypt:async()=>{throw Error('Must not decrypt');}});
 const bad=[[],Array(51).fill(files[0]),null,[{}],[' ' .repeat(2049)],
  [changed(x=>x['x-ethers']={})],[changed(x=>x.privateKey='forbidden')],[changed(x=>x.version='3')],[changed(x=>x.id='bad')],
  [changed(x=>x.address=x.address.toUpperCase())],[changed(x=>x.crypto.extra=true)],[changed(x=>x.crypto.cipher='AES-128-CTR')],
  [changed(x=>x.crypto.kdf='pbkdf2')],[changed(x=>x.crypto.kdfparams.n=1024)],[changed(x=>x.crypto.kdfparams.r=9)],
  [changed(x=>x.crypto.kdfparams.p=2)],[changed(x=>x.crypto.kdfparams.dklen=64)],[changed(x=>x.crypto.kdfparams.salt='00')],
  [changed(x=>x.crypto.cipherparams.extra=1)],[changed(x=>x.crypto.cipherparams.iv='00')],[changed(x=>x.crypto.mac='00')],[changed(x=>x.crypto.ciphertext='00')],
  [files[0],files[0]],[files[0],'{"malformed":true}'],[files[0]+' '.repeat(2048)],[files[0]+'é'.repeat(800)]];
 for(const input of bad)await assert.rejects(h.v.importNodeKeystores(input,PASSWORD),{message:SAFE});
 assert.equal(h.stats.decrypts,0);
 for(const p of ['short','x'.repeat(129)])await assert.rejects(h.v.importNodeKeystores(files,p),/12 to 128/);
 assert.equal(h.stats.decrypts,0);
});
test('input ownership, sequential KDF, global lock and throwing progress observers remain bounded',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r);let calls=0;
 const h=harness({decrypt:async(input,p,progress)=>{if(++calls===1){entered();await gate;}progress?.(0);progress?.(.5);progress?.(1);return fixtureWallets.find(w=>w.address.toLowerCase()===`0x${JSON.parse(input).address}`);}});
 const inputs=[...files],pending=h.v.importNodeKeystores(inputs,PASSWORD,()=>{throw Error('Observer must not cancel');});await start;
 inputs.reverse();inputs.length=0;
 await assert.rejects(h.v.importNodeKeystores(files,PASSWORD),/in progress/);
 const generated=h.v.createNodeSession(1);await assert.rejects(h.v.encryptNodeBackup(generated,PASSWORD),/in progress/);
 release();const s=await pending;assert.deepEqual(s.addresses,addresses);assert.equal(h.stats.maxActive,1);assert.equal(h.stats.decrypts,5);h.v.forgetNodeSession(s);h.v.forgetNodeSession(generated);
});
test('actual wrong password and middle-file failure are sanitized and allow a later complete import',async()=>{
 await assert.rejects(main.v.importNodeKeystores(files,'Wrong disposable password'),{message:SAFE});
 const opts={fail:true};const h=harness({decrypt:async input=>{const i=files.indexOf(input);if(opts.fail&&i===2)throw Error('sensitive-canary-must-not-escape');return fixtureWallets[i];}});
 await assert.rejects(h.v.importNodeKeystores(files,PASSWORD),{message:SAFE});assert.equal(h.stats.decrypts,3);
 opts.fail=false;const s=await h.v.importNodeKeystores(files,PASSWORD);assert.deepEqual(s.addresses,addresses);h.v.forgetNodeSession(s);
 const mismatch=harness({decrypt:async()=>fixtureWallets[1]});await assert.rejects(mismatch.v.importNodeKeystores(files,PASSWORD),{message:SAFE});assert.equal(mismatch.stats.decrypts,1);
});
test('HD and imported prepare/sign/export selectors bind every node address without broadcasting',async()=>{
 const h=harness({decrypt:async input=>new h.Wallet(fixtureWallets[files.indexOf(input)].privateKey)});
 const imported=await h.v.importNodeKeystores(files,PASSWORD),generated=h.v.createNodeSession(5);
 // Restore the HD backup to obtain its normal verified authority.
 const hdBackup=await h.v.encryptNodeBackup(generated,PASSWORD);
 const hdLoader=harness();const restored=await hdLoader.v.restoreNodeBackup(hdBackup,PASSWORD);
 for(const [owner,s] of [[h,imported],[hdLoader,restored]])for(let i=0;i<5;i++)for(const kind of ['Trade','Bridge']){
  const r=kind==='Trade'?await owner.v.prepareNodeTrade(s,i,'0x1111111111111111111111111111111111111111','buy',5):await owner.v.prepareNodeBridge(s,i,'1');
  assert.equal(r.nodeAddress,s.addresses[i]);const result=await owner.v['executeNode'+kind](s,r);assert.equal(ethers.utils.parseTransaction(result.raw).from,s.addresses[i]);
 }
 for(const bad of [-1,5,1.5])await assert.rejects(h.v.exportNodeKeystore(imported,bad,PASSWORD),/Invalid node index/);
 await assert.rejects(h.v.executeNodeTrade({...imported},{nodeIndex:0,nodeAddress:addresses[0]}),/no longer available/);
 await assert.rejects(h.v.executeNodeTrade(imported,{nodeIndex:0,nodeAddress:addresses[1]}),/another node/);
 h.v.forgetNodeSession(imported);h.v.forgetNodeSession(generated);hdLoader.v.forgetNodeSession(restored);
});
for(const kind of ['Trade','Bridge'])for(const stage of ['before','after','expiry'])test(`${kind} imported authority rejects ${stage} sign revocation before returning signed bytes`,async()=>{
 const options={now:1000};const h=harness(options);options.decrypt=async()=>new h.Wallet(fixtureWallets[0].privateKey);
 const s=await h.v.importNodeKeystores([files[0]],PASSWORD),review={nodeIndex:0,nodeAddress:s.addresses[0]};
 if(stage==='before')options.beforeSign=()=>h.v.forgetNodeSession(s);
 else options.afterSign=()=>{if(stage==='expiry')options.now+=h.v.NODE_IDLE_MS;else h.v.forgetNodeSession(s);};
 await assert.rejects(h.v['executeNode'+kind](s,review),/no longer available/);
 assert.equal(h.stats.signs,stage==='before'?0:1);assert.equal(h.stats.returned,0);assert.equal(h.v.isVerifiedNodeSession(s),false);
});
