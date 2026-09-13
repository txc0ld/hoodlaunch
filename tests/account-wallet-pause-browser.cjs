// Consolidates sell-all-wallet-session-browser.cjs under the revised pause contract.
// Coverage mapping: plain click/focus/visibility/navigation and double failures -> scenario();
// HTTP empty/HTML, transport/body failures and shared deadlines -> freshPage matrices;
// auth/malformed/revocation/logout/pagehide -> terminal and stale-response matrices.
// Real direct vault and epoch behavior is covered by node-account-suspension.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const DEPS = process.env.UI_TEST_DEPS || path.join(ROOT, 'node_modules');
const ts = require(path.join(DEPS, 'typescript'));
const transpile = file => ts.transpileModule(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const sources = { bridge: transpile('src/components/NodeBridge.tsx'), pro: transpile('src/components/ProAccess.tsx'), launchpad: transpile('src/components/PonsLaunchpad.tsx') };
const reactFiles = {
  react: 'react/cjs/react.development.js',
  'react-dom': 'react-dom/cjs/react-dom.development.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.development.js',
  scheduler: 'scheduler/cjs/scheduler.development.js',
};
const reactSources = Object.fromEntries(Object.entries(reactFiles).map(([name, file]) => [name, fs.readFileSync(path.join(DEPS, file), 'utf8')]));
const ethersSource = fs.readFileSync(path.join(DEPS, 'ethers/dist/ethers.umd.js'), 'utf8');
const setup = `
const process={env:{NODE_ENV:'development'}},reactSources=${JSON.stringify(reactSources)},reactModules={};
function reactRequire(name){if(reactModules[name])return reactModules[name].exports;const module={exports:{}};reactModules[name]=module;new Function('require','module','exports','process',reactSources[name])(reactRequire,module,module.exports,process);return module.exports;}
const React=reactRequire('react'),ReactDOM=reactRequire('react-dom/client');
const jsx=(type,props,key)=>React.createElement(type,{...props,key}),runtime={jsx,jsxs:jsx,Fragment:React.Fragment};
const nativeTimeout=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=milliseconds=>nativeTimeout(Math.min(milliseconds,500));
const IDENTITY='a'.repeat(64),NODE1='0x1111111111111111111111111111111111111111',NODE2='0x2222222222222222222222222222222222222222',TOKEN='0x3333333333333333333333333333333333333333';
const session=Object.freeze({id:'verified-fixture',addresses:Object.freeze([NODE1,NODE2]),backupVerified:true});
const access={sessionIdentity:IDENTITY,configured:true,signInAvailable:true,walletSignInAvailable:true,signedIn:true,pro:true,billing:true,billingAccount:false,billingAccountUnavailable:false,subscription:true,subscriptionUnavailable:false,holder:{address:null,verified:false,eligible:false,granted:false,balance:null,unavailable:false}};
const state={statusCalls:0,statusMode:'active',transientFailures:0,broadcasts:[],runs:0,stopped:0,forgetCalls:0,focusEvents:0,visibilityEvents:0,pagehideEvents:0,managerMounts:0,tradingMounts:0,accessChanges:[],identityChanges:[]};
window.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);if(url!=='/api/account')throw Error('Unexpected fixture request');
 if(body.action==='request-code'){state.requestCodeCalls=(state.requestCodeCalls||0)+1;return new Response(JSON.stringify({sent:true}),{status:200});}
 if(body.action==='auth-prepare')return new Response(JSON.stringify({prepared:true}),{status:200});
 if(body.action==='verify-code'){state.verifyCodeCalls=(state.verifyCodeCalls||0)+1;state.statusMode='active';return new Response(JSON.stringify({signedIn:true}),{status:200});}
 if(body.action==='logout'){state.logoutCalls=(state.logoutCalls||0)+1;if(state.logoutFailures){state.logoutFailures--;return new Response('',{status:503});}state.statusMode='signed-out';return new Response(JSON.stringify({signedIn:false}),{status:200});}
 if(body.action!=='status')throw Error('Unexpected fixture request');state.statusCalls++;if(window.previousStatusSignal===options.signal)state.sharedSignals=(state.sharedSignals||0)+1;window.previousStatusSignal=options.signal;
 if(state.networkFailures){state.networkFailures--;throw new TypeError('Fixture transport interruption');}
 if(state.bodyFailures){state.bodyFailures--;return new Response(new ReadableStream({start(controller){controller.error(new TypeError('Fixture body interruption'));}}),{status:200});}
 if(state.statusMode==='body-deadline')return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});}}),{status:200});
 if(state.statusMode==='deadline'){if(!state.deadlineStep){state.deadlineStep=1;await new Promise(r=>setTimeout(r,300));return new Response('',{status:503});}return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
 if(state.statusMode==='unauthorized')return new Response(JSON.stringify({error:'Account authorization denied'}),{status:401});
 if(state.statusMode==='malformed')return new Response('{',{status:200});
 if(state.statusMode==='invalid-shape')return new Response(JSON.stringify({signedIn:true,pro:true,sessionIdentity:IDENTITY}),{status:200});
 if(state.statusMode==='throttled')return new Response('',{status:429});
 if(state.statusMode==='timeout')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 if(state.statusMode==='signed-out')return new Response(JSON.stringify({...access,signedIn:false,pro:false,sessionIdentity:null}),{status:200});
 if(state.statusMode==='revoked')return new Response(JSON.stringify({...access,pro:false,subscription:false}),{status:200});
 if(state.statusMode==='other-owner')return new Response(JSON.stringify({...access,sessionIdentity:'b'.repeat(64)}),{status:200});
 if(state.transientFailures>0){state.transientFailures--;return new Response(state.transientBody==='empty'?'':state.transientBody==='html'?'<html>Unavailable</html>':JSON.stringify({error:'Temporary status outage'}),{status:503,headers:{'Content-Type':'application/json'}});}
 if(state.statusMode==='held')return new Promise(resolve=>{window.releaseHeldStatus=()=>resolve(new Response(JSON.stringify(access),{status:200,headers:{'Content-Type':'application/json'}}));});
 return new Response(JSON.stringify(access),{status:200,headers:{'Content-Type':'application/json'}});
};
window.addEventListener('focus',()=>state.focusEvents++);document.addEventListener('visibilitychange',()=>state.visibilityEvents++);window.addEventListener('pagehide',()=>state.pagehideEvents++);
state.accountReady=false;state.accountEpoch=0;
const fixtureGate={setNodeAccountAccess:(identity,pro,ready)=>{if(state.accountReady&&!ready)state.accountEpoch++;state.accountReady=Boolean(identity&&pro&&ready);}};
const noop=()=>null,styles={default:new Proxy({},{get:(_,key)=>String(key)})};
function load(source,modules){const module={exports:{}};new Function('require','module','exports',source)(id=>modules[id]||(id.endsWith('.css')?styles:{default:noop}),module,module.exports);return module.exports.default;}
function Manager({onSessionChange}){state.managerMounts++;React.useLayoutEffect(()=>{onSessionChange(session);return()=>onSessionChange(null);},[onSessionChange]);return jsx('div',{},'Verified fixture wallet');}
function Trading({session}){
 state.tradingMounts++;
 const live=React.useRef(true);React.useLayoutEffect(()=>{live.current=true;window.runFixtureBatch=run;return()=>{live.current=false;delete window.runFixtureBatch;};},[session]);
 async function run(){if(!session)return;state.runs++;const captured=session,epoch=state.accountEpoch;
  const guard=()=>{if(!live.current||captured!==session||!state.accountReady||epoch!==state.accountEpoch)throw Error('session invalidated');};
  try{
   guard();state.broadcasts.push('node-1');
   if(state.scenario==='held'){state.statusMode='held';window.dispatchEvent(new Event('focus'));}
   if(state.scenario==='double-failure'){state.transientFailures=2;window.dispatchEvent(new Event('focus'));}
   if(state.scenario==='focus'){window.dispatchEvent(new Event('focus'));}
   if(state.scenario==='visible'){document.dispatchEvent(new Event('visibilitychange'));}
   if(state.scenario==='pagehide'){window.dispatchEvent(new Event('pagehide'));}
   await new Promise(resolve=>{window.releaseWrite=resolve;});guard();state.broadcasts.push('node-2');
  }catch{state.stopped++;}
 }
 return jsx('button',{type:'button',disabled:!session,onClick:()=>void run()},'Run two-node batch');
}
const launchModules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':{forgetNodeSession:value=>{if(value===session)state.forgetCalls++;}},
 '../lib/pons':{getProtocolState:async()=>({chainId:4663,launchFeeWei:'1',maxCreatorTaxBps:1000,configs:[]}),refreshWallet:async()=>null,onWalletChange:()=>()=>{},getLaunchOperation:()=>null,launchOperationKey:()=>'',validateImageUri:()=>{},PONS_EXPLORER:'https://example.test'},
 '../lib/pons-planning':{getPonsPlanningSnapshot:()=>null},
 '../lib/pons-holder-fees':{holderFeeLaunchBlocker:()=>'',holderFeeLaunchDraft:value=>value,rememberHolderFeeIntent:noop,preparedHolderFeeIntent:()=>null,bindHolderFeeLaunch:()=>null},
 '../lib/wallet-provider':{getWalletVersion:()=>0},'../lib/wallet-connection':{boundedWalletRequest:value=>value},
 './NodeManager':{default:Manager},'./NodeTrading':{default:Trading},'./TokenLab':{default:noop,PonsLaunchPlan:noop},'./TokenLinks':{default:noop},'./HolderFeeSharing':{default:noop},'./LabHero':{default:noop},'./PairSelector':{default:noop},
};
const Bridge=load(${JSON.stringify(sources.bridge)},{'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':{prepareNodeBridge:async()=>{state.bridgePrepares=(state.bridgePrepares||0)+1;throw Error('Unexpected preparation while paused');},executeNodeBridge:async()=>{throw Error('Unexpected bridge send');}},
 '../lib/relay-bridge':{getNodeBridgeOperation:()=>({status:'pending',message:'Fixture pending bridge',requestId:'inert-bridge',sourceTxHash:'0x'+'11'.repeat(32)}),refreshNodeBridgeOperation:async()=>{state.bridgeRefreshes=(state.bridgeRefreshes||0)+1;return {status:'complete',message:'Fixture confirmed bridge',requestId:'inert-bridge',sourceTxHash:'0x'+'11'.repeat(32)};}}
});
window.mountPausedBridge=()=>{const container=document.createElement('div');container.id='paused-bridge-fixture';document.body.appendChild(container);ReactDOM.createRoot(container).render(jsx(Bridge,{session,nodeIndex:0,accountReadiness:false}));};
const Launchpad=load(${JSON.stringify(sources.launchpad)},launchModules);
const emptyAccess={sessionIdentity:null,configured:false,signInAvailable:false,walletSignInAvailable:false,signedIn:false,pro:false,billing:false,billingAccount:false,billingAccountUnavailable:false,subscription:false,subscriptionUnavailable:false,holder:{address:null,verified:false,eligible:false,granted:false,balance:null,unavailable:false}};
const proModules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':fixtureGate,
 '../lib/pro-access':{EMPTY_PRO_ACCESS:emptyAccess,HOODRICH_DECIMALS:18,HOODRICH_MINIMUM_FORMATTED:'666,666',HOODRICH_TOKEN:TOKEN},
 '../lib/wallet-signin':{AUTH_INTENT_EVENT:'fixture-auth-intent',assertClientAuthCurrent:noop,cancelClientAuth:async()=>{},cancelPendingAuth:async()=>{},completeClientAuth:noop,pendingAuthIds:()=>[],signInWithWallet:async()=>{},startClientAuth:()=>({requestId:'fixture',tabId:'fixture'})},
 '../lib/holder-wallet':{verifyHolderWallet:async()=>{}},'../lib/wallet-provider':{getWalletProvider:()=>null,getWalletVersion:()=>0,subscribeWalletProvider:()=>()=>{}},
};
const ProAccess=load(${JSON.stringify(sources.pro)},proModules);
function App(){const[pro,setPro]=React.useState(false),[identity,setIdentity]=React.useState(null);const access=React.useCallback(value=>{state.accessChanges.push(value);setPro(value);},[]),identify=React.useCallback(value=>{state.identityChanges.push(value);setIdentity(value);},[]);return jsx(Launchpad,{launchEnabled:false,generationEnabled:true,nodeTradingEnabled:true,financeEnabled:false,proEnabled:pro,sessionIdentity:identity,proPanel:jsx(ProAccess,{onAccessChange:access,onSessionIdentityChange:identify})});}
ReactDOM.createRoot(document.getElementById('root')).render(jsx(App,{}));
window.test={state,start:value=>{state.scenario=value;},run:()=>window.runFixtureBatch(),releaseWrite:()=>window.releaseWrite(),releaseStatus:()=>window.releaseHeldStatus(),setVisible:()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));}};
`;
const html = '<!doctype html><div id="root"></div><script>' + ethersSource.replace(/<\/script/gi, '<\\/script') + '</script><script>' + setup.replace(/<\/script/gi, '<\\/script') + '</script>';

async function scenario(browser, name, check) {
  const context = await browser.newContext();
  const navigations = [];
  await context.route('**/*', route => route.request().isNavigationRequest()
    ? (navigations.push(route.request().url()), route.fulfill({ status: 200, contentType: 'text/html', body: html }))
    : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:41923/');
  try { await page.waitForFunction(() => typeof window.runFixtureBatch === 'function'); }
  catch (error) { console.error(JSON.stringify({ name, errors, state:await page.evaluate(()=>test.state), buttons:await page.locator('button').allTextContents(), body: (await page.locator('body').innerText()).slice(-3000) })); throw error; }
  await page.evaluate(value => test.start(value), name);
  await page.evaluate(() => { void test.run(); });
  await page.waitForFunction(() => test.state.broadcasts.length === 1);
  await check(page, navigations);
  assert.deepEqual(errors, []);
  const result = await page.evaluate(() => ({ ...test.state, broadcasts: [...test.state.broadcasts] }));
  await context.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    async function freshPage(check) {
      const context=await browser.newContext();
      await context.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort());
      const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://localhost:41923/');await page.getByText(/Pro active/).waitFor();
      try { await check(page);assert.deepEqual(errors,[]); } finally { await context.close(); }
    }
    for(const mode of ['throttled','timeout','body-deadline','deadline']) await freshPage(async page=>{
      await page.evaluate(mode=>{test.state.statusMode=mode;window.dispatchEvent(new Event('focus'));},mode);
      await page.getByText('Account verification paused',{exact:true}).waitFor();
      const paused=await page.evaluate(()=>({...test.state}));assert.equal(paused.forgetCalls,0);assert.equal(paused.accountReady,false);if(mode==='deadline'){await page.getByText(/Account verification is temporarily unavailable/).waitFor();assert.equal(await page.evaluate(()=>test.state.statusCalls),3);assert.equal(await page.evaluate(()=>test.state.sharedSignals),1);}else assert.equal(paused.statusCalls,2);
      await page.evaluate(()=>{test.state.statusMode='active';});await page.getByRole('button',{name:'Retry account verification',exact:true}).click();
      await page.getByText(/Pro active/).waitFor();assert.equal(await page.evaluate(()=>test.state.forgetCalls),0);
    });
    for(const kind of ['empty','html','network','body']) await freshPage(async page=>{
      await page.evaluate(kind=>{if(kind==='network')test.state.networkFailures=1;else if(kind==='body')test.state.bodyFailures=1;else{test.state.transientBody=kind;test.state.transientFailures=1;}window.dispatchEvent(new Event('focus'));},kind);
      await page.waitForFunction(()=>test.state.statusCalls===3&&test.state.accountReady);
      assert.equal(await page.evaluate(()=>test.state.forgetCalls),0);assert.equal(await page.evaluate(()=>test.state.sharedSignals),1);
    });
    await freshPage(async page=>{
      await page.evaluate(()=>{test.state.logoutFailures=1;});await page.locator('#pro-account details summary').click();
      await page.getByRole('button',{name:'Sign out & lock wallets',exact:true}).click();await page.getByText('Account services are unavailable.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>test.state.logoutCalls),1);assert.equal(await page.evaluate(()=>test.state.forgetCalls),1);
    });
    for(const mode of ['unauthorized','malformed','invalid-shape','signed-out','revoked','other-owner']) await freshPage(async page=>{
      await page.evaluate(mode=>{test.state.statusMode=mode;window.dispatchEvent(new Event('focus'));},mode);
      await page.waitForFunction(()=>test.state.forgetCalls===1);
      assert.equal(await page.evaluate(()=>test.state.statusCalls),2);
      if(mode!=='other-owner')assert.equal(await page.evaluate(()=>test.state.accountReady),false);
    });
    await freshPage(async page=>{
      await page.evaluate(()=>{test.state.transientFailures=1;test.state.statusMode='held';window.dispatchEvent(new Event('focus'));});
      await page.waitForFunction(()=>test.state.statusCalls===3);assert.equal(await page.evaluate(()=>test.state.accountReady),false);
      await page.evaluate(()=>{for(let i=0;i<5;i++)window.dispatchEvent(new Event('focus'));});
      assert.equal(await page.evaluate(()=>test.state.statusCalls),3,'concurrent status requests coalesce');
      await page.evaluate(()=>test.releaseStatus());await page.getByText(/Pro active/).waitFor();assert.equal(await page.evaluate(()=>test.state.forgetCalls),0);
    });
    await freshPage(async page=>{
      await page.evaluate(()=>{test.state.statusMode='held';window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>test.state.statusCalls===2);
      await page.locator('#pro-account details summary').click();await page.getByRole('button',{name:'Sign out & lock wallets',exact:true}).click();
      await page.getByText('Signed out',{exact:true}).waitFor();await page.evaluate(()=>test.releaseStatus());await page.waitForTimeout(30);
      assert.equal(await page.evaluate(()=>test.state.accountReady),false);assert.equal(await page.evaluate(()=>test.state.identityChanges.at(-1)),null);
      assert.equal(await page.evaluate(()=>test.state.logoutCalls),1);
    });
    await freshPage(async page=>{
      await page.evaluate(()=>{test.state.statusMode='signed-out';window.dispatchEvent(new Event('focus'));});await page.getByText('Signed out',{exact:true}).waitFor();
      await page.locator('#pro-account details summary').click();await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');
      await page.getByRole('button',{name:'Email me a code',exact:true}).click();await page.getByLabel('Email code',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>test.state.requestCodeCalls),1);await page.getByLabel('Email code',{exact:true}).fill('123456');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByText(/Pro active/).waitFor();assert.equal(await page.evaluate(()=>test.state.verifyCodeCalls),1);
    });
    await freshPage(async page=>{
      await page.evaluate(()=>window.mountPausedBridge());
      const bridge=page.locator('#paused-bridge-fixture');
      await bridge.getByText('Fixture pending bridge',{exact:true}).waitFor();
      assert.equal(await bridge.getByRole('button',{name:'Bridge to Robinhood Chain',exact:true}).isDisabled(),true);
      const refresh=bridge.getByRole('button',{name:'Refresh bridge status',exact:true});assert.equal(await refresh.isEnabled(),true);await refresh.click();
      await bridge.getByText('Fixture confirmed bridge',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.state.bridgeRefreshes),1);assert.equal(await page.evaluate(()=>test.state.bridgePrepares||0),0);
    });
    const held = await scenario(browser, 'held', async (page, navigations) => {
      await page.waitForFunction(() => test.state.statusCalls === 2);
      await page.evaluate(() => test.releaseWrite());
      await page.waitForFunction(() => test.state.broadcasts.length === 2);
      assert.equal(await page.evaluate(() => typeof window.runFixtureBatch), 'function', 'an in-deadline status delay retains the workspace');
      await page.evaluate(() => test.releaseStatus());
      assert.equal(navigations.length, 1, 'status delay does not navigate');
    });
    assert.deepEqual(held.broadcasts, ['node-1', 'node-2']);
    assert.equal(held.forgetCalls, 0);

    const failed = await scenario(browser, 'double-failure', async (page, navigations) => {
      await page.waitForFunction(() => test.state.statusCalls === 3);
      await page.waitForTimeout(30);
      await page.evaluate(() => test.releaseWrite());
      await page.waitForFunction(() => test.state.stopped === 1);
      assert.equal(navigations.length, 1, 'two status failures fail closed without navigation');
    });
    assert.deepEqual(failed.broadcasts, ['node-1']);
    console.log('ACCOUNT_DOUBLE_FAILURE ' + JSON.stringify(failed));
    assert.equal(failed.forgetCalls, 0, 'A temporary account outage must pause writes while retaining the same loaded wallet');

    for (const event of ['focus', 'visible']) {
      const healthy = await scenario(browser, event, async (page, navigations) => {
        await page.waitForFunction(() => test.state.statusCalls === 2);
        await page.evaluate(() => test.releaseWrite());
        await page.waitForFunction(() => test.state.broadcasts.length === 2);
        assert.equal(await page.evaluate(() => typeof window.runFixtureBatch), 'function', event + ' refresh retains the workspace');
        assert.equal(navigations.length, 1);
      });
      assert.deepEqual(healthy.broadcasts, ['node-1', 'node-2']);
      assert.equal(healthy.forgetCalls, 0);
    }

    const hidden = await scenario(browser, 'pagehide', async (page, navigations) => {
      await page.waitForTimeout(30);
      await page.evaluate(() => test.releaseWrite());
      await page.waitForFunction(() => test.state.stopped === 1);
      assert.equal(navigations.length, 1, 'synthetic pagehide does not itself navigate');
    });
    assert.deepEqual(hidden.broadcasts, ['node-1']);
    assert.equal(hidden.forgetCalls, 1);

    console.log(JSON.stringify({ pass: true, checks: { held, failed, focusAndVisible: true, pagehide: hidden } }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
