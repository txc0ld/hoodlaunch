const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[3] || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const DEPS = process.argv[2] || path.join(ROOT, 'node_modules');
const ts = require(path.join(DEPS, 'typescript'));
const ethers = require(path.join(DEPS, 'ethers'));
const transpile = file => ts.transpileModule(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const vaultSource = transpile('src/lib/node-vault.ts');
const componentSource = transpile('src/components/NodeManager.tsx');
const vault = {};
new Function('exports', 'require', vaultSource)(vault, id => {
  if (id === 'ethers') return ethers;
  if (id === './pons-trade') return { copyTradeAmount() { throw Error('No trade during recovery'); } };
  throw Error('Unexpected recovery dependency');
});
const reactSources = Object.fromEntries(Object.entries({
  react: 'react/cjs/react.development.js', 'react-dom': 'react-dom/cjs/react-dom.development.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.development.js', scheduler: 'scheduler/cjs/scheduler.development.js',
}).map(([name, file]) => [name, fs.readFileSync(path.join(DEPS, file), 'utf8')]));
const PASSWORD = 'Disposable shared import password';
(async () => {
  const hd = vault.createNodeSession(5);
  const addresses = [...hd.addresses];
  const backup = await vault.encryptNodeBackup(hd, PASSWORD);
  const files = [];
  for (let i = 0; i < 5; i++) files.push(await vault.exportNodeKeystore(hd, i, PASSWORD));
  vault.forgetNodeSession(hd);
  const setup = `
const process={env:{NODE_ENV:'development'}},reactSources=${JSON.stringify(reactSources)},reactModules={};
function reactRequire(name){if(reactModules[name])return reactModules[name].exports;const module={exports:{}};reactModules[name]=module;new Function('require','module','exports','process',reactSources[name])(reactRequire,module,module.exports,process);return module.exports;}
const React=reactRequire('react'),ReactDOM=reactRequire('react-dom/client');
const jsx=(type,props,key)=>React.createElement(type,{...props,key}),runtime={jsx,jsxs:jsx,Fragment:React.Fragment};
const stats={reservations:0,network:0,storage:0,signs:0,forgets:0,publications:0};
window.fetch=()=>{stats.network++;throw Error('No network during recovery');};
for(const key of ['getItem','setItem','removeItem','clear'])Storage.prototype[key]=()=>{stats.storage++;throw Error('No storage during recovery');};
ethers.Wallet.prototype.signTransaction=()=>{stats.signs++;throw Error('No signing during recovery');};
const actual={};new Function('exports','require',${JSON.stringify(vaultSource)})(actual,id=>{if(id==='ethers')return ethers;if(id==='./pons-trade')return {copyTradeAmount(){throw Error('No trade during recovery');}};throw Error('Unexpected dependency');});
let latest=null,held=null,release=null,hold=false;
const wrapped={...actual,forgetNodeSession(s){stats.forgets++;actual.forgetNodeSession(s);},async importNodeKeystores(...args){const s=await actual.importNodeKeystores(...args);if(hold){held=s;await new Promise(r=>release=r);}return s;}};
class GenerationError extends Error{}
async function nodeGenerationRequest(identity,attempt){if(attempt){stats.reservations++;throw Error('No reservation during recovery');}return {sessionIdentity:identity,enabled:true,available:false,maxCount:1,nextEligibleAt:null};}
const req=id=>id==='react'?React:id==='react/jsx-runtime'?runtime:id==='ethers'?ethers:id.endsWith('.css')?new Proxy({},{get:(_,k)=>String(k)}):id==='../lib/node-vault'?wrapped:id==='../lib/node-balances'?{getNodeBalances(){throw Error('No balances during recovery');}}:id==='../lib/node-generation'?{GenerationError,nodeGenerationRequest}:id==='./NodeBridge'||id==='./ExchangeFunding'?{default:()=>{throw Error('Finance unavailable');}}:null;
const m={exports:{}};new Function('require','module','exports',${JSON.stringify(componentSource)})(req,m,m.exports);
const root=ReactDOM.createRoot(document.getElementById('root'));
const publish=s=>{latest=s;if(s)stats.publications++;};
function render(key='a'){root.render(React.createElement(m.exports.default,{key,sessionIdentity:key.repeat(64),proEnabled:false,financeEnabled:false,onSessionChange:publish}));}
window.test={render,stats,view:()=>latest?{id:latest.id,addresses:[...latest.addresses]}:null,hold(){hold=true;held=null;},held:()=>!!held,release(){hold=false;release();},heldForgotten:()=>held&&!actual.isVerifiedNodeSession(held)};
render();`;
  const umd = fs.readFileSync(path.join(DEPS, 'ethers/dist/ethers.umd.js'), 'utf8');
  const html = '<!doctype html><div id="root"></div><script>' + umd.replace(/<\/script/gi, '<\\/script') + '</script><script>' + setup.replace(/<\/script/gi, '<\\/script') + '</script>';
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context = await browser.newContext({acceptDownloads:true});
    const requests=[],errors=[];
    await context.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort());
    const page=await context.newPage();page.setDefaultTimeout(60000);
    page.on('request',r=>requests.push(r.resourceType()));page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:41918/');
    const open=()=>page.getByRole('button',{name:/Prepare controlled funding wallets/}).click();
    await open();
    const payload=(text,i)=>({name:`disposable-${i}.json`,mimeType:'application/json',buffer:Buffer.from(text)});
    async function importFiles(values,password=PASSWORD){
      await page.getByLabel('Encrypted individual keystore files').setInputFiles(values.map(payload));
      await page.getByLabel('Shared keystore password',{exact:true}).fill(password);
      await page.getByRole('button',{name:'Import keystores',exact:true}).click();
    }
    async function clearInputs(){
      assert.equal(await page.getByLabel('Shared keystore password',{exact:true}).inputValue(),'');
      assert.equal(await page.getByLabel('Encrypted individual keystore files').inputValue(),'');
      const visible=await page.locator('body').innerText();
      for(const secret of [PASSWORD,'Wrong disposable shared password',...files.map(f=>JSON.parse(f).crypto.ciphertext)])assert.ok(!visible.includes(secret));
      assert.ok(!/\b[0-9a-f]{64}\b/i.test(visible),'No raw key or ciphertext in visible UI');
    }
    const view=()=>page.evaluate(()=>test.view());
    await page.getByLabel('Encrypted node backup file',{exact:true}).setInputFiles(payload(backup,0));
    await page.getByLabel('Backup password for restore').fill(PASSWORD);
    await page.getByRole('button',{name:'Verify and restore',exact:true}).click();
    await page.getByText('5 wallets verified',{exact:true}).waitFor();
    assert.deepEqual((await view()).addresses,addresses);
    const originalId=(await view()).id;
    await importFiles([files[0]],'Wrong disposable shared password');
    await page.getByRole('alert').getByText('Unable to import encrypted keystores. Check the files and shared password.').waitFor();
    assert.equal((await view()).id,originalId);await clearInputs();
    for(const bad of [['{}'],[files[0],files[0]],[' '.repeat(2049)]]){
      await importFiles(bad);await page.getByRole('button',{name:'Import keystores',exact:true}).waitFor();
      assert.equal((await view()).id,originalId);await clearInputs();
    }
    await importFiles([files[4]]);
    await page.getByText('These keystores contain different wallets. Confirm replacement before importing them.',{exact:true}).waitFor();
    assert.equal((await view()).id,originalId);await clearInputs();
    await page.getByRole('checkbox').check();
    const order=[4,0,3,1,2];await importFiles(order.map(i=>files[i]));
    await page.waitForFunction(id=>test.view()?.id!==id,originalId);
    await page.getByRole('button',{name:'Import keystores',exact:true}).waitFor();
    assert.deepEqual((await view()).addresses,order.map(i=>addresses[i]));await clearInputs();
    assert.equal(await page.getByRole('button',{name:'Replace wallets',exact:true}).isDisabled(),true);
    const outputPassword='Disposable fresh export password';
    await page.getByLabel('Node to export').selectOption('3');await page.getByLabel('Keystore password',{exact:true}).fill(outputPassword);
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download keystore',exact:true}).click();
    const download=await downloadPromise,stream=await download.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);
    const exported=Buffer.concat(chunks).toString();assert.equal((await ethers.Wallet.fromEncryptedJson(exported,outputPassword)).address,addresses[1]);
    await download.delete();
    console.log(JSON.stringify({check:'real Edge HD5 restore, ordered keystore5 import, failure preservation, confirmation, Free recovery, encrypted export',pass:true}));
    for(const action of ['lock','pagehide','identity-unmount']){
      await page.evaluate(()=>test.hold());await importFiles([files[0]]);await page.waitForFunction(()=>test.held());
      if(action==='lock')await page.getByRole('button',{name:'Lock wallets',exact:true}).click();
      else if(action==='pagehide')await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
      else await page.evaluate(()=>test.render('b'));
      await page.evaluate(()=>test.release());await page.waitForFunction(()=>test.heldForgotten());
      assert.equal(await view(),null);
      if(action==='identity-unmount')await open();
      await page.getByRole('button',{name:'Import keystores',exact:true}).waitFor();await clearInputs();
      console.log(JSON.stringify({check:`late completed import forgotten after ${action}`,pass:true}));
    }
    const displayed=await page.locator('body').innerText();
    for(const secret of [PASSWORD,outputPassword,JSON.parse(files[0]).crypto.ciphertext,JSON.parse(backup).encryptedRoot])if(typeof secret==='string')assert.ok(!displayed.includes(secret));
    const stats=await page.evaluate(()=>test.stats);
    for(const key of ['reservations','network','storage','signs'])assert.equal(stats[key],0,key);
    assert.deepEqual(requests,['document']);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({check:'no external requests, quota reservation, storage, signing, secret display or browser errors',pass:true,stats,requests}));
    await context.close();
  }finally{await browser.close();}
})().catch(()=>{console.error('FAIL: disposable browser recovery assertion; no secret details logged');process.exit(1);});
