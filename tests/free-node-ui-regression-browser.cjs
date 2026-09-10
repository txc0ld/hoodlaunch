const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.argv[3] || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const DEPS = process.env.UI_TEST_DEPS || process.argv[2] || path.join(ROOT, 'node_modules');
const ts = require(path.join(DEPS, 'typescript'));
const source = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'src/components/NodeManager.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const reactFiles = {
  react: 'react/cjs/react.development.js',
  'react-dom': 'react-dom/cjs/react-dom.development.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.development.js',
  scheduler: 'scheduler/cjs/scheduler.development.js',
};
const reactSources = Object.fromEntries(Object.entries(reactFiles).map(([name, file]) => [name, fs.readFileSync(path.join(DEPS, file), 'utf8')]));
const ethers = fs.readFileSync(path.join(DEPS, 'ethers/dist/ethers.umd.js'), 'utf8');
const setup = `
const process={env:{NODE_ENV:'development'}};
const reactSources=${JSON.stringify(reactSources)},reactModules={};
function reactRequire(name){if(reactModules[name])return reactModules[name].exports;const module={exports:{}};reactModules[name]=module;new Function('require','module','exports','process',reactSources[name])(reactRequire,module,module.exports,process);return module.exports;}
const React=reactRequire('react'),ReactDOM=reactRequire('react-dom/client');
const jsx=(type,props,key)=>React.createElement(type,{...props,key}),runtime={jsx,jsxs:jsx,Fragment:React.Fragment};
window.__test={reserveCalls:[],createCalls:0,forgets:0};
class GenerationError extends Error{constructor(message,code,nextEligibleAt=null){super(message);this.code=code;this.nextEligibleAt=nextEligibleAt;}}
async function nodeGenerationRequest(identity,attempt){if(!attempt)return {sessionIdentity:identity,enabled:true,available:true,maxCount:50,nextEligibleAt:null};__test.reserveCalls.push({...attempt});return {reserved:true,sessionIdentity:identity,requestId:attempt.requestId,count:attempt.count,reservedAt:'2026-09-11T00:00:00Z',nextEligibleAt:null};}
const vault={MAX_NODES:50,createNodeSession(count){__test.createCalls++;return {id:'x',addresses:Array(count).fill('0x1111111111111111111111111111111111111111'),backupVerified:false};},async encryptNodeBackup(){return '{}';},async restoreNodeBackup(){throw Error('not expected');},isVerifiedNodeSession:s=>s.backupVerified,forgetNodeSession(){__test.forgets++;},recordNodeActivity(){},async exportNodeKeystore(){throw Error('not expected');}};
const modules={};
function load(source){const m={exports:{}};const req=id=>id==='react'?React:id==='react/jsx-runtime'?runtime:id==='ethers'?ethers:id.endsWith('.css')?new Proxy({},{get:(_,k)=>String(k)}):id==='../lib/node-vault'?vault:id==='../lib/node-balances'?{getNodeBalances:async()=>{throw Error('not expected')}}:id==='../lib/node-generation'?{GenerationError,nodeGenerationRequest}:id==='./NodeBridge'||id==='./ExchangeFunding'?{default:()=>null}:null;new Function('require','module','exports',source)(req,m,m.exports);return m.exports.default;}
const NodeManager=load(${JSON.stringify(source)});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(NodeManager,{sessionIdentity:'a'.repeat(64),proEnabled:true,financeEnabled:false}));
`;
const html = '<!doctype html><div id="root"></div><script>' + ethers.replace(/<\/script/gi, '<\\/script') + '</script><script>' + setup.replace(/<\/script/gi, '<\\/script') + '</script>';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ status: 200, contentType: 'text/html', body: html }) : route.abort());
    const page = await context.newPage(), pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://localhost:41894/');
    await page.getByRole('button', { name: /Prepare controlled funding wallets/ }).click();
    const count = page.getByLabel('Wallet count');
    await count.fill('1.5');
    await page.getByLabel('Backup password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Generate wallet' }).click();
    await page.getByRole('alert').getByText('Choose a whole number from 1 to 50.').waitFor();
    assert.equal(await count.isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => __test.reserveCalls), []);
    assert.equal(await page.evaluate(() => __test.createCalls), 0);
    await count.fill('2');
    await page.getByLabel('Backup password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Generate wallet' }).click();
    await page.getByText('2 wallets created; backup not yet verified', { exact: true }).waitFor();
    const observed = await page.evaluate(() => __test);
    assert.equal(observed.reserveCalls.length, 1);
    assert.equal(observed.reserveCalls[0].count, 2);
    assert.equal(observed.createCalls, 1);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ name: 'fractional count refusal remains recoverable before reservation or key creation', pass: true, observed }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
