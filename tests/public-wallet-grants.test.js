const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{createRequire}=require('node:module');
const OWNER='0x1111111111111111111111111111111111111111',NEAR='0x1111111111111111111111111111111111111112';
function load(file){const filename=path.resolve(file),module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:createRequire(filename),process},{filename});return module.exports;}
function withAllowlist(t,value){const old=process.env.PRO_WALLET_ALLOWLIST;if(value===undefined)delete process.env.PRO_WALLET_ALLOWLIST;else process.env.PRO_WALLET_ALLOWLIST=value;t.after(()=>{if(old===undefined)delete process.env.PRO_WALLET_ALLOWLIST;else process.env.PRO_WALLET_ALLOWLIST=old;});}
test('wallet grant config is optional, exact, case-normalized and immediately revocable',t=>{
 withAllowlist(t,OWNER.toUpperCase().replace('0X','0x'));const grants=load('src/server/public-wallet-grants.ts');
 assert.equal(grants.isPublicWalletGranted(OWNER),true);assert.equal(grants.isPublicWalletGranted(OWNER.toUpperCase().replace('0X','0x')),true);
 for(const value of [NEAR,OWNER.slice(0,-1),OWNER+'00','0x'+'0'.repeat(40),null,undefined])assert.equal(grants.isPublicWalletGranted(value),false);
 delete process.env.PRO_WALLET_ALLOWLIST;assert.equal(grants.isPublicWalletGranted(OWNER),false);
});
test('any malformed, zero, over-count or over-length allowlist fails closed as a whole',t=>{
 withAllowlist(t,'');const grants=load('src/server/public-wallet-grants.ts');
 for(const value of [undefined,'','   ',`${OWNER},bad`,`${OWNER},0x${'0'.repeat(40)}`,`${OWNER},`,Array(101).fill(OWNER).join(','),' '.repeat(5001)]){
  if(value===undefined)delete process.env.PRO_WALLET_ALLOWLIST;else process.env.PRO_WALLET_ALLOWLIST=value;
  assert.equal(grants.isPublicWalletGranted(OWNER),false,value?.slice(0,80));
 }
});
test('public source and defaults contain no owner wallet or browser-visible grant config',()=>{
 const env=fs.readFileSync('.env.example','utf8'),source=fs.readFileSync('src/server/public-wallet-grants.ts','utf8');
 assert.match(env,/^PRO_WALLET_ALLOWLIST=$/m);assert.doesNotMatch(env,/NEXT_PUBLIC_PRO/i);assert.doesNotMatch(source,/0x[0-9a-f]{40}/i);
 const ui=fs.readFileSync('src/components/ProAccess.tsx','utf8');assert.match(ui,/wallet grant/i);assert.match(ui,/holder\.granted/);assert.match(ui,/Verify holding wallet/);
});
