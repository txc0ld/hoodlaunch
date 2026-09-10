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
const reactFiles = { react: 'react/cjs/react.development.js', 'react-dom': 'react-dom/cjs/react-dom.development.js', 'react-dom/client': 'react-dom/cjs/react-dom-client.development.js', scheduler: 'scheduler/cjs/scheduler.development.js' };
const reactSources = Object.fromEntries(Object.entries(reactFiles).map(([name, file]) => [name, fs.readFileSync(path.join(DEPS, file), 'utf8')]));
const ethers = fs.readFileSync(path.join(DEPS, 'ethers/dist/ethers.umd.js'), 'utf8');
const setup = `
const process={env:{NODE_ENV:'development'}};
const reactSources=${JSON.stringify(reactSources)},reactModules={};
function reactRequire(name){if(reactModules[name])return reactModules[name].exports;const module={exports:{}};reactModules[name]=module;new Function('require','module','exports','process',reactSources[name])(reactRequire,module,module.exports,process);return module.exports;}
const React=reactRequire('react'),ReactDOM=reactRequire('react-dom/client'),DOM=reactRequire('react-dom');
const jsx=(type,props,key)=>React.createElement(type,{...props,key}),runtime={jsx,jsxs:jsx,Fragment:React.Fragment};
window.__test={callbacks:[],forgets:[],layoutCallbacks:0,signs:0,broadcasts:0};
const live=new Set();
function Manager(props){
 React.useLayoutEffect(()=>{__test.callbacks.push(props.onSessionChange);return()=>{__test.layoutCallbacks++;props.onSessionChange({id:'stale-layout',addresses:[]});};},[]);
 return jsx('div',{'data-manager':true,'data-finance':props.financeEnabled});
}
function Trading({session}){return jsx('div',{'data-trading':session?.id||'none'});}
const noop=()=>null;
const modules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':{forgetNodeSession:s=>{__test.forgets.push(s.id);live.delete(s);}},
 '../lib/pons-planning':{getPonsPlanningSnapshot:()=>null},
 '../lib/pons-holder-fees':{holderFeeLaunchBlocker:()=>''},
 '../lib/pons':{getProtocolState:async()=>{throw Error('Offline fixture');},refreshWallet:async()=>null,onWalletChange:()=>()=>{}},
 '../lib/wallet-provider':{getWalletVersion:()=>0},
 '../lib/wallet-connection':{boundedWalletRequest:p=>p},
 './TokenLab':{default:noop,PonsLaunchPlan:noop},
 './NodeManager':{default:Manager},'./NodeTrading':{default:Trading}
};
const module={exports:{}};
new Function('require','module','exports',${JSON.stringify(source)})(id=>modules[id]||(id.endsWith('.css')?{default:new Proxy({},{get:(_,k)=>String(k)})}:{default:noop}),module,module.exports);
const root=ReactDOM.createRoot(document.getElementById('root'));
window.renderWorkspace=props=>DOM.flushSync(()=>root.render(jsx(module.exports.default,props)));
window.publishSession=id=>{const session={id,addresses:[]};live.add(session);DOM.flushSync(()=>__test.callbacks.at(-1)(session));window.currentSession=session;};
// Models the core's existing requireSession checks at signing and broadcast.
window.queueSigning=()=>{const session=currentSession;window.resumeSigning=()=>{if(!live.has(session))return;__test.signs++;if(!live.has(session))return;__test.broadcasts++;};};
`;
const html = '<!doctype html><div id="root"></div><script>' + ethers.replace(/<\/script/gi, '<\\/script') + '</script><script>' + setup.replace(/<\/script/gi, '<\\/script') + '</script>';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const context=await browser.newContext();
  await context.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort());
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:41895/');
  const base={sessionIdentity:'a'.repeat(64),proEnabled:true,generationEnabled:true,nodeTradingEnabled:true,launchEnabled:false};
  for(const [name,change] of Object.entries({account:{sessionIdentity:'b'.repeat(64)},logout:{sessionIdentity:null},pro:{proEnabled:false},generation:{generationEnabled:false},trading:{nodeTradingEnabled:false},launch:{launchEnabled:true}})){
   await page.evaluate(props=>renderWorkspace(props),base);
   await page.evaluate(id=>publishSession(id),name);
   assert.equal(await page.locator('[data-trading]').getAttribute('data-trading'),name);
   await page.evaluate(()=>{window.oldCallback=__test.callbacks.at(-1);queueSigning();});
   const result=await page.evaluate(props=>{
    renderWorkspace(props);
    // Runs synchronously immediately after commit, before a new task/effect tick.
    resumeSigning();oldCallback({id:'late-old',addresses:[]});
    return {forgets:[...__test.forgets],signs:__test.signs,broadcasts:__test.broadcasts};
   },{...base,...change});
   assert.ok(result.forgets.includes(name));assert.equal(result.signs,0);assert.equal(result.broadcasts,0);
   if(change.proEnabled===false||change.generationEnabled===false||change.nodeTradingEnabled===false||change.sessionIdentity===null) assert.equal(await page.locator('[data-trading]').count(),0);
   else assert.equal(await page.locator('[data-trading]').getAttribute('data-trading'),'none');
   await page.evaluate(props=>renderWorkspace(props),base);
   await page.evaluate(()=>publishSession('new-owner'));
   await page.evaluate(()=>{oldCallback(null);oldCallback({id:'late-old',addresses:[]});});
   assert.equal(await page.locator('[data-trading]').getAttribute('data-trading'),'new-owner');
  }
  const observed=await page.evaluate(()=>__test);
  assert.ok(observed.layoutCallbacks>=6);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,cases:6,layoutCallbacks:observed.layoutCallbacks,signs:observed.signs,broadcasts:observed.broadcasts,scope:'Actual PonsLaunchpad with mocked financial children and vault; core covered by separate suite.'}));
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
