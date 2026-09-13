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
const sources = {
  pro: transpile('src/components/ProAccess.tsx'),
  launchpad: transpile('src/components/PonsLaunchpad.tsx'),
  trading: transpile('src/components/NodeTrading.tsx'),
};
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
const nativeTimeout=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=milliseconds=>nativeTimeout(Math.min(milliseconds,100));
const IDENTITY='a'.repeat(64),NODE='0x1111111111111111111111111111111111111111',TOKEN='0x2222222222222222222222222222222222222222';
const session=Object.freeze({id:'verified-fixture',addresses:Object.freeze([NODE]),backupVerified:true});
const state={statusCalls:0,focusEvents:0,forgetCalls:0,batchExecutions:0,transientFailures:0,transientBody:'json',networkFailures:0,bodyFailures:0,statusMode:'active',focusOnExecute:false,sharedSignalCalls:0,deadlineStep:0,logoutCalls:0,logoutFailures:0};
const access={sessionIdentity:IDENTITY,configured:true,signInAvailable:true,walletSignInAvailable:true,signedIn:true,pro:true,billing:true,billingAccount:false,billingAccountUnavailable:false,subscription:true,subscriptionUnavailable:false,holder:{address:null,verified:false,eligible:false,granted:false,balance:null,unavailable:false}};
window.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);if(url!=='/api/account')throw Error('Unexpected fixture request');
 if(body.action==='logout'){state.logoutCalls++;if(state.logoutFailures>0){state.logoutFailures--;return new Response('',{status:503});}state.statusMode='signed-out';return new Response(JSON.stringify({signedIn:false}),{status:200,headers:{'Content-Type':'application/json'}});}
 if(body.action!=='status')throw Error('Unexpected fixture request');
 state.statusCalls++;
 if(window.lastStatusSignal===options.signal)state.sharedSignalCalls++;window.lastStatusSignal=options.signal;
 if(state.networkFailures>0){state.networkFailures--;throw new TypeError('Fixture network interruption');}
 if(state.bodyFailures>0){state.bodyFailures--;const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"signedIn":'));controller.error(new TypeError('Fixture response body interruption'));}});return new Response(stream,{status:200,headers:{'Content-Type':'application/json'}});}
 if(state.transientFailures>0){state.transientFailures--;const body=state.transientBody==='html'?'<html>temporary proxy failure</html>':state.transientBody==='empty'?'':JSON.stringify({error:'Temporary account status outage'});return new Response(body,{status:503,headers:{'Content-Type':state.transientBody==='json'?'application/json':'text/html'}});}
 if(state.statusMode==='unauthorized')return new Response(JSON.stringify({error:'Session is no longer authorized'}),{status:401,headers:{'Content-Type':'application/json'}});
 if(state.statusMode==='throttled')return new Response('',{status:429,headers:{'Retry-After':'60'}});
 if(state.statusMode==='malformed')return new Response('{',{status:200,headers:{'Content-Type':'application/json'}});
 if(state.statusMode==='body-deadline'){const stream=new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});}});return new Response(stream,{status:200,headers:{'Content-Type':'application/json'}});}
 if(state.statusMode==='deadline'){
  if(state.deadlineStep++===0){await new Promise(resolve=>setTimeout(resolve,60));return new Response(JSON.stringify({error:'Temporary account status outage'}),{status:503,headers:{'Content-Type':'application/json'}});}
  return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 }
 if(state.statusMode==='held')return new Promise(resolve=>{window.releaseHeldStatus=()=>resolve(new Response(JSON.stringify(access),{status:200,headers:{'Content-Type':'application/json'}}));});
 const result=state.statusMode==='signed-out'?{...access,sessionIdentity:null,signedIn:false,pro:false,subscription:false}:state.statusMode==='revoked'?{...access,pro:false,subscription:false}:access;
 return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
};
window.addEventListener('focus',()=>state.focusEvents++);
const emptyAccess={sessionIdentity:null,configured:false,signInAvailable:false,walletSignInAvailable:false,signedIn:false,pro:false,billing:false,billingAccount:false,billingAccountUnavailable:false,subscription:false,subscriptionUnavailable:false,holder:{address:null,verified:false,eligible:false,granted:false,balance:null,unavailable:false}};
const noop=()=>null,styles={default:new Proxy({},{get:(_,key)=>String(key)})};
function load(source,modules){const module={exports:{}};new Function('require','module','exports',source)(id=>modules[id]||(id.endsWith('.css')?styles:{default:noop}),module,module.exports);return module.exports.default;}
const tradingModules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':{prepareNodeTrade:async()=>{throw Error('Individual trade not expected');},executeNodeTrade:async()=>{throw Error('Individual trade not expected');}},
 '../lib/node-trading':{getNodeTradeOperation:()=>null,refreshNodeTradeOperation:async()=>{throw Error('Refresh not expected');}},
 '../lib/pons-trade':{
  copyTradeAmount:value=>value,parseTradeAmount:()=>ethers.BigNumber.from(1),
  getNodeTradingSnapshot:async()=>({tokenAddress:TOKEN,symbol:'TEST',decimals:18,totalSupplyRaw:'1000000000000000000000',phase:0,blockNumber:100,phaseMessage:'Trading available',tradingAvailable:true,balances:[{nodeAddress:NODE,ethBalanceWei:'1000000000000000000',tokenBalanceRaw:'100000000000000000000',supplySharePercent:'10'}]})
 },
 '../lib/node-trade-batch':{
  prepareNodeTradeBatch:async(current,token,side,assertCurrent)=>{assertCurrent();const now=Date.now();const review={requestId:'review-fixture',nodeAddress:NODE,nodeIndex:0,tokenAddress:TOKEN,side,percent:100,customAmount:null,decimals:18,symbol:'TEST',action:'sell',route:'PONS curve',amountInRaw:'100000000000000000000',expectedOutputRaw:'100000000000000000',minimumOutputRaw:'98000000000000000',minimumIsRateBound:false,slippageBps:200,maxGasCostWei:'100000000000000',maxTotalEthWei:'100000000000000',balanceAfterMaxCostWei:'999900000000000000',requiredRemainingEthWei:'100000000000000',gasReserveWei:'100000000000000',expectedSpendWei:'0',expectedRefundWei:'0',gasLimit:'100000',maxFeePerGasWei:'1000000000',maxPriorityFeePerGasWei:'100000000',expiresAt:now+30000,createdAt:now};return {requestId:'batch-fixture',tokenAddress:token,side,mode:'trades',createdAt:now,expiresAt:now+30000,maxGasCostWei:'100000000000000',maxTotalEthWei:'100000000000000',entries:[{nodeAddress:NODE,nodeIndex:0,status:'ready',review}]};},
  executeNodeTradeBatch:async(current,batch,assertCurrent,onProgress)=>{state.batchExecutions++;assertCurrent();if(state.focusOnExecute){state.transientFailures=1;state.transientBody='html';window.dispatchEvent(new Event('focus'));await new Promise(resolve=>setTimeout(resolve,50));}assertCurrent();const operation={nodeAddress:NODE,nodeIndex:0,tokenAddress:TOKEN,action:'sell',status:'pending',txHash:'0x'+'33'.repeat(32),message:'Pending'};const result={nodeAddress:NODE,nodeIndex:0,status:'submitted',operation};onProgress(result);return [result];}
 }
};
const Trading=load(${JSON.stringify(sources.trading)},tradingModules);
function Manager({onSessionChange}){React.useLayoutEffect(()=>{onSessionChange(session);return()=>onSessionChange(null);},[onSessionChange]);return jsx('div',{'data-manager':'mounted'},'Verified fixture wallet');}
const launchModules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':{forgetNodeSession:value=>{if(value===session)state.forgetCalls++;}},
 '../lib/pons':{getProtocolState:async()=>({chainId:4663,launchFeeWei:'1',maxCreatorTaxBps:1000,configs:[]}),refreshWallet:async()=>null,onWalletChange:()=>()=>{},getLaunchOperation:()=>null,launchOperationKey:()=>'',validateImageUri:()=>{},PONS_EXPLORER:'https://example.test'},
 '../lib/pons-planning':{getPonsPlanningSnapshot:()=>null},
 '../lib/pons-holder-fees':{holderFeeLaunchBlocker:()=>'',holderFeeLaunchDraft:value=>value,rememberHolderFeeIntent:noop,preparedHolderFeeIntent:()=>null,bindHolderFeeLaunch:()=>null},
 '../lib/wallet-provider':{getWalletVersion:()=>0},'../lib/wallet-connection':{boundedWalletRequest:value=>value},
 './NodeManager':{default:Manager},'./NodeTrading':{default:Trading},'./TokenLab':{default:noop,PonsLaunchPlan:noop},
 './TokenLinks':{default:noop},'./HolderFeeSharing':{default:noop},'./LabHero':{default:noop},'./PairSelector':{default:noop},
};
const Launchpad=load(${JSON.stringify(sources.launchpad)},launchModules);
const proModules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/pro-access':{EMPTY_PRO_ACCESS:emptyAccess,HOODRICH_DECIMALS:18,HOODRICH_MINIMUM_FORMATTED:'666,666',HOODRICH_TOKEN:TOKEN},
 '../lib/wallet-signin':{AUTH_INTENT_EVENT:'fixture-auth-intent',assertClientAuthCurrent:noop,cancelClientAuth:async()=>{},cancelPendingAuth:async()=>{},completeClientAuth:noop,pendingAuthIds:()=>[],signInWithWallet:async()=>{},startClientAuth:()=>({requestId:'fixture',tabId:'fixture'})},
 '../lib/holder-wallet':{verifyHolderWallet:async()=>{}},
 '../lib/wallet-provider':{getWalletProvider:()=>null,getWalletVersion:()=>0,subscribeWalletProvider:()=>()=>{}},
};
const ProAccess=load(${JSON.stringify(sources.pro)},proModules);
function App(){const[pro,setPro]=React.useState(false),[identity,setIdentity]=React.useState(null);return jsx(Launchpad,{launchEnabled:false,generationEnabled:true,nodeTradingEnabled:true,financeEnabled:false,proEnabled:pro,sessionIdentity:identity,proPanel:jsx(ProAccess,{onAccessChange:setPro,onSessionIdentityChange:setIdentity})});}
const root=ReactDOM.createRoot(document.getElementById('root'));root.render(jsx(App,{}));
window.test={state,setFocusOnExecute:value=>state.focusOnExecute=value,setStatusMode:value=>{state.statusMode=value;state.deadlineStep=0;},setTransientFailures:(value,body='json')=>{state.transientFailures=value;state.transientBody=body;},setNetworkFailures:value=>state.networkFailures=value,setBodyFailures:value=>state.bodyFailures=value,setLogoutFailures:value=>state.logoutFailures=value,focus:()=>window.dispatchEvent(new Event('focus')),pagehide:()=>window.dispatchEvent(new Event('pagehide')),releaseHeld:()=>window.releaseHeldStatus()};
`;

const html = '<!doctype html><div id="root"></div><script>' + ethersSource.replace(/<\/script/gi, '<\\/script') + '</script><script>' + setup.replace(/<\/script/gi, '<\\/script') + '</script>';

(async () => {
  const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch({ headless: true, ...launchOptions });
  try {
    const context = await browser.newContext();
    const navigation = [];
    await context.route('**/*', route => {
      if (route.request().isNavigationRequest()) {
        navigation.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      }
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:41922/');
    await page.getByText(/Pro active/).waitFor();
    await page.getByLabel('PONS token address').fill('0x2222222222222222222222222222222222222222');
    await page.getByRole('button', { name: 'Verify token and load holdings', exact: true }).click();
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).waitFor();

    const before = await page.evaluate(() => ({ ...test.state }));
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).click();
    await page.getByText(/Submitted.*awaiting confirmation/).first().waitFor();
    const withoutFocus = await page.evaluate(() => ({ ...test.state }));
    assert.equal(withoutFocus.statusCalls, before.statusCalls, 'The Sell All click does not itself dispatch a window focus refresh');
    assert.equal(navigation.length, 1, 'The Sell All click does not navigate or reload the document');
    assert.equal(withoutFocus.forgetCalls, 0, 'The Sell All click alone keeps the verified node session');

    await page.reload();
    await page.getByText(/Pro active/).waitFor();
    await page.getByLabel('PONS token address').fill('0x2222222222222222222222222222222222222222');
    await page.getByRole('button', { name: 'Verify token and load holdings', exact: true }).click();
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).waitFor();
    await page.evaluate(() => test.setFocusOnExecute(true));
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).click();
    await page.waitForTimeout(150);
    const withFocusFailure = await page.evaluate(() => ({ ...test.state }));
    const tradingVisible = await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count();
    console.log(JSON.stringify({ phase: 'observation', withoutFocus, withFocusFailure, navigationCount: navigation.length, tradingVisible, errors }));
    assert.equal(navigation.length, 2, 'Focus-return account verification must not cause document navigation');
    assert.equal(tradingVisible, 1, 'A single retryable account-status failure must not discard the unlocked wallet session');
    assert.equal(withFocusFailure.forgetCalls, 0, 'A single retryable account-status failure must not forget the verified node session');

    async function restoreActiveAccess() {
      await page.evaluate(() => { test.setStatusMode('active'); test.setTransientFailures(0); test.setFocusOnExecute(false); test.focus(); });
      await page.getByText(/Pro active/).waitFor();
      if (!await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count()) {
        await page.getByLabel('PONS token address').fill('0x2222222222222222222222222222222222222222');
        await page.getByRole('button', { name: 'Verify token and load holdings', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).waitFor();
    }
    async function openAccountDetails() {
      const details = page.locator('#pro-account details');
      if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
    }
    const beforeDoubleFailure = withFocusFailure.statusCalls;
    await page.evaluate(() => { test.setTransientFailures(2); test.focus(); });
    await page.getByText('Temporary account status outage', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 0, 'Two retryable failures fail closed');
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeDoubleFailure, 2, 'Status refresh retries only once');

    await restoreActiveAccess();
    const beforeUnauthorized = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setStatusMode('unauthorized'); test.focus(); });
    await page.getByText('Session is no longer authorized', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 0, 'Authorization failures fail closed');
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeUnauthorized.statusCalls, 1, 'Authorization failures are not retried');

    await restoreActiveAccess();
    const beforeThrottle = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setStatusMode('throttled'); test.focus(); });
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeThrottle.statusCalls, 1, 'A 429 response is not retried without Retry-After handling');

    await restoreActiveAccess();
    await openAccountDetails();
    const beforeFailedLogout = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => test.setLogoutFailures(1));
    await page.getByRole('button', { name: 'Sign out & lock wallets', exact: true }).click();
    await page.getByText('Account services are unavailable.', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => test.state.logoutCalls)) - beforeFailedLogout.logoutCalls, 1, 'A failed logout mutation is not retried');

    await restoreActiveAccess();
    await page.evaluate(() => { test.setStatusMode('signed-out'); test.focus(); });
    await page.getByText('Signed out', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 0, 'A confirmed logout locks the wallet workspace');

    await restoreActiveAccess();
    await page.evaluate(() => { test.setStatusMode('revoked'); test.focus(); });
    await page.getByText('Free account', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 0, 'A confirmed Pro revocation removes node trading');

    await restoreActiveAccess();
    const beforeEmptyFailure = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setTransientFailures(1, 'empty'); test.focus(); });
    await page.waitForFunction(calls => test.state.statusCalls >= calls + 2, beforeEmptyFailure.statusCalls);
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 1, 'An empty 503 body keeps the loaded wallet session after retry');
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeEmptyFailure.statusCalls, 2, 'An empty 503 response retries once');

    await restoreActiveAccess();
    const beforeNetworkFailure = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setNetworkFailures(1); test.focus(); });
    await page.waitForFunction(calls => test.state.statusCalls >= calls + 2, beforeNetworkFailure.statusCalls);
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 1, 'A single network failure keeps the loaded wallet session after retry');
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeNetworkFailure.statusCalls, 2, 'A network failure retries once');

    await restoreActiveAccess();
    const beforeBodyFailure = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setBodyFailures(1); test.focus(); });
    await page.waitForTimeout(150);
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeBodyFailure.statusCalls, 2, 'A response-body network failure retries once');
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 1, 'A response-body network failure keeps the loaded wallet session after retry');

    await restoreActiveAccess();
    const beforeBodyDeadline = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setStatusMode('body-deadline'); test.focus(); });
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeBodyDeadline.statusCalls, 1, 'An aborted response body is not retried');

    await restoreActiveAccess();
    const beforeMalformed = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setStatusMode('malformed'); test.focus(); });
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => test.state.statusCalls)) - beforeMalformed.statusCalls, 1, 'Malformed successful JSON is not retried');

    await restoreActiveAccess();
    const beforeDeadline = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setStatusMode('deadline'); test.focus(); });
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).waitFor({ state: 'detached' });
    const afterDeadline = await page.evaluate(() => ({ ...test.state }));
    assert.equal(afterDeadline.statusCalls - beforeDeadline.statusCalls, 2, 'A retryable response can consume the remaining shared deadline once');
    assert.equal(afterDeadline.sharedSignalCalls - beforeDeadline.sharedSignalCalls, 1, 'Both status attempts use the same deadline signal');

    await restoreActiveAccess();
    await openAccountDetails();
    const beforeStaleLogout = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => { test.setStatusMode('held'); test.focus(); });
    await page.waitForTimeout(20);
    await page.getByRole('button', { name: 'Sign out & lock wallets', exact: true }).click();
    await page.getByText('Signed out', { exact: true }).waitFor();
    await page.evaluate(() => test.releaseHeld());
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 0, 'A stale successful status response cannot restore access after logout');
    assert.equal((await page.evaluate(() => test.state.logoutCalls)) - beforeStaleLogout.logoutCalls, 1, 'The fixture exercised the actual logout mutation once');

    await restoreActiveAccess();
    const beforePagehide = await page.evaluate(() => ({ ...test.state }));
    await page.evaluate(() => test.pagehide());
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).count(), 0, 'Page hide locks the wallet workspace');
    assert.ok((await page.evaluate(() => test.state.forgetCalls)) > beforePagehide.forgetCalls, 'Page hide forgets the verified node session');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, check: 'Sell All focus retry, double failure, unauthorized, logout, revocation, and pagehide lifecycle controls', final: await page.evaluate(() => test.state) }));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
