const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.argv[3] || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const DEPS = process.env.UI_TEST_DEPS || process.argv[2] || path.join(ROOT, 'node_modules');
const ts = require(path.join(DEPS, 'typescript'));
const source = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'src/components/PonsLaunchpad.tsx'), 'utf8'), {
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
const React=reactRequire('react'),ReactDOM=reactRequire('react-dom/client'),DOM=reactRequire('react-dom');
const jsx=(type,props,key)=>React.createElement(type,{...props,key}),runtime={jsx,jsxs:jsx,Fragment:React.Fragment};
window.__test={uploads:[],revoked:[],created:0};
URL.createObjectURL=()=>{__test.created++;return 'blob:fixture-'+__test.created;};
URL.revokeObjectURL=value=>__test.revoked.push(value);
window.fetch=(url,options)=>new Promise(resolve=>__test.uploads.push({url,signal:options.signal,resolve}));
const noop=()=>null;
const modules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':{forgetNodeSession:()=>{}},
 '../lib/pons-planning':{getPonsPlanningSnapshot:()=>null,applyPonsPlan:d=>d},
 '../lib/pons-holder-fees':{holderFeeLaunchBlocker:()=>'',holderFeeLaunchDraft:d=>d,rememberHolderFeeIntent:()=>{},preparedHolderFeeIntent:()=>false,bindHolderFeeLaunch:()=>null},
 '../lib/pons':{getProtocolState:async()=>({chainId:4663,launchFeeWei:'1',maxCreatorTaxBps:0,configs:[]}),refreshWallet:async()=>null,onWalletChange:()=>()=>{},getLaunchOperation:()=>null,launchOperationKey:()=>'',validateImageUri:()=>{},PONS_EXPLORER:'https://example.com'},
 '../lib/wallet-provider':{getWalletVersion:()=>0,walletRegistry:{disconnect(){},getSelection:()=>0}},
 '../lib/wallet-connection':{boundedWalletRequest:p=>p},
 './TokenLab':{default:noop,PonsLaunchPlan:noop}
};
const m={exports:{}};
new Function('require','module','exports',${JSON.stringify(source)})(id=>modules[id]||(id.endsWith('.css')?{default:new Proxy({},{get:(_,k)=>String(k)})}:{default:noop}),m,m.exports);
const root=ReactDOM.createRoot(document.getElementById('root'));
window.__render=identity=>DOM.flushSync(()=>root.render(jsx(m.exports.default,{sessionIdentity:identity,launchEnabled:true,generationEnabled:false,nodeTradingEnabled:false,proPanel:jsx('div',{})})));
window.__resolve=(index,uri)=>__test.uploads[index].resolve({ok:true,json:async()=>({uri})});
window.__fail=(index,message)=>__test.uploads[index].resolve({ok:false,json:async()=>({error:message})});
window.__render('a'.repeat(64));
window.__dropSameFileTwice=()=>{
 const dropzone=document.querySelector('[aria-label="Choose token image"]').parentElement;
 const same=new File([new Uint8Array([1,2,3,4])],'same.png',{type:'image/png',lastModified:1700000000000});
 const fire=()=>{const transfer=new DataTransfer();transfer.items.add(same);dropzone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));};
 fire();fire();
};
`;
const html = '<!doctype html><div id="root"></div><script>' + ethers.replace(/<\/script/gi, '<\\/script') + '</script><script>' + setup.replace(/<\/script/gi, '<\\/script') + '</script>';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ status: 200, contentType: 'text/html', body: html }) : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:41903/');
    const chooser = page.getByLabel('Choose token image', { exact: true });
    const uriInput = page.getByLabel('Token image URI', { exact: true });

    await page.evaluate(() => __dropSameFileTwice());
    await page.waitForFunction(() => __test.uploads.length === 1);
    assert.equal(await page.evaluate(() => __test.uploads[0].signal.aborted), false);
    await page.evaluate(() => __fail(0, 'Provider rejected the image.'));
    await page.getByRole('alert').getByText('Provider rejected the image.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
    await page.waitForFunction(() => __test.uploads.length === 2);
    await page.evaluate(() => __resolve(1, 'ipfs://same'));
    await page.waitForFunction(() => document.querySelector('[aria-label="Token image URI"]').value === 'ipfs://same');

    await chooser.setInputFiles({ name: 'account-a.png', mimeType: 'image/png', buffer: Buffer.from('fixture-a') });
    await page.waitForFunction(() => __test.uploads.length === 3);
    await page.evaluate(() => __render('b'.repeat(64)));
    await page.evaluate(() => __resolve(2, 'ipfs://account-a'));
    await page.waitForTimeout(0);
    assert.equal(await uriInput.inputValue(), '');
    assert.equal(await page.evaluate(() => __test.uploads[2].signal.aborted), true);
    assert.ok((await page.evaluate(() => __test.revoked)).includes('blob:fixture-3'));

    await chooser.setInputFiles({ name: 'older.png', mimeType: 'image/png', buffer: Buffer.from('older') });
    await page.waitForFunction(() => __test.uploads.length === 4);
    await chooser.setInputFiles({ name: 'newer.png', mimeType: 'image/png', buffer: Buffer.from('newer') });
    await page.waitForFunction(() => __test.uploads.length === 5);
    await page.evaluate(() => __resolve(4, 'ipfs://newer'));
    await page.waitForFunction(() => document.querySelector('[aria-label="Token image URI"]').value === 'ipfs://newer');
    await page.evaluate(() => __resolve(3, 'ipfs://older'));
    await page.waitForTimeout(0);
    assert.equal(await uriInput.inputValue(), 'ipfs://newer');
    assert.equal(await page.evaluate(() => __test.uploads[3].signal.aborted), true);

    await chooser.setInputFiles({ name: 'removed.png', mimeType: 'image/png', buffer: Buffer.from('removed') });
    await page.waitForFunction(() => __test.uploads.length === 6);
    await page.getByRole('button', { name: 'Remove token image', exact: true }).click();
    await page.evaluate(() => __resolve(5, 'ipfs://removed'));
    await page.waitForTimeout(0);
    assert.equal(await uriInput.inputValue(), '');
    assert.equal(await page.evaluate(() => __test.uploads[5].signal.aborted), true);

    await chooser.setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: Buffer.from('pending') });
    await page.waitForFunction(() => __test.uploads.length === 7);
    await chooser.setInputFiles({ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await page.getByRole('alert').getByText('Choose a PNG, JPEG, or WebP image.', { exact: true }).waitFor();
    await page.evaluate(() => __resolve(6, 'ipfs://pending-before-invalid'));
    await page.waitForTimeout(0);
    assert.equal(await uriInput.inputValue(), '');
    assert.equal(await page.evaluate(() => __test.uploads[6].signal.aborted), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ check: 'duplicate, failure retry, account, replacement, removal, and invalid-newer selection upload fences', pass: true, uploads: 7 }));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
