const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const DEPS = process.env.UI_TEST_DEPS || path.join(ROOT, 'node_modules');
const ts = require(path.join(DEPS, 'typescript'));
// Keep the production deadline behavior while accelerating the outage regression.
const componentText = fs.readFileSync(path.join(ROOT, 'src/components/NodeTrading.tsx'), 'utf8').replace('const STATUS_REFRESH_DEADLINE_MS = 20_000;', 'const STATUS_REFRESH_DEADLINE_MS = 600;');
const source = ts.transpileModule(componentText, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const reactFiles = { react: 'react/cjs/react.development.js', 'react-dom': 'react-dom/cjs/react-dom.development.js', 'react-dom/client': 'react-dom/cjs/react-dom-client.development.js', scheduler: 'scheduler/cjs/scheduler.development.js' };
const reactSources = Object.fromEntries(Object.entries(reactFiles).map(([name, file]) => [name, fs.readFileSync(path.join(DEPS, file), 'utf8')]));
const ethersSource = fs.readFileSync(path.join(DEPS, 'ethers/dist/ethers.umd.js'), 'utf8');
const setup = `
const process={env:{NODE_ENV:'development'}},reactSources=${JSON.stringify(reactSources)},reactModules={};
function reactRequire(name){if(reactModules[name])return reactModules[name].exports;const module={exports:{}};reactModules[name]=module;new Function('require','module','exports','process',reactSources[name])(reactRequire,module,module.exports,process);return module.exports;}
const React=reactRequire('react'),ReactDOM=reactRequire('react-dom/client');
const jsx=(type,props,key)=>React.createElement(type,{...props,key}),runtime={jsx,jsxs:jsx,Fragment:React.Fragment};
const TOKEN='0x2222222222222222222222222222222222222222',PREVIOUS_TOKEN='0x3333333333333333333333333333333333333333',nodes=Object.freeze(Array.from({length:5},(_,index)=>'0x'+String(index+1).padStart(40,'0'))),session=Object.freeze({id:'status-fixture',addresses:nodes,backupVerified:true});
const state={refreshCalls:0,refreshByNode:{},activeRefreshes:0,maxRefreshes:0,snapshotCalls:0,snapshotFailures:0,nodeBalanceCallbacks:0,batchPrepares:[],batchExecutes:[],batchProgress:0,holdBatch:false,hangReads:false,hungResolvers:[],confirmed:false,confirmedNodes:new Set(),confirmPrevious:false,slowNode:nodes[0],failNode:'',failNodeCount:0,operations:{}};
function operation(node,side,status='pending',tokenAddress=TOKEN,hashOffset=10){return {nodeAddress:node,nodeIndex:nodes.indexOf(node),tokenAddress,action:side,side,status,txHash:'0x'+String(nodes.indexOf(node)+hashOffset).padStart(64,'0'),message:status==='confirmed'?'Trade confirmed on Robinhood Chain. Refresh holdings for the latest balances.':'Waiting for two Robinhood confirmations. Do not resubmit.'};}
function review(node,index,side){const now=Date.now();return {requestId:side+'-'+index,nodeAddress:node,nodeIndex:index,tokenAddress:TOKEN,side,percent:100,customAmount:null,decimals:18,symbol:'TEST',action:side,route:'PONS curve',amountInRaw:'1000000000000000000',expectedOutputRaw:'1000000000000000000',minimumOutputRaw:'980000000000000000',minimumIsRateBound:false,slippageBps:200,maxGasCostWei:'100000000000000',maxTotalEthWei:'100000000000000',balanceAfterMaxCostWei:'999900000000000000',requiredRemainingEthWei:'100000000000000',gasReserveWei:'100000000000000',expectedSpendWei:'0',expectedRefundWei:'0',gasLimit:'100000',maxFeePerGasWei:'1000000000',maxPriorityFeePerGasWei:'100000000',expiresAt:now+30000,createdAt:now};}
state.operations[nodes[0].toLowerCase()]=operation(nodes[0],'sell','pending',PREVIOUS_TOKEN,50);
const modules={
 'react':React,'react/jsx-runtime':runtime,'ethers':ethers,
 '../lib/node-vault':{prepareNodeTrade:async()=>{throw Error('Individual trade not expected');},executeNodeTrade:async()=>{throw Error('Individual trade not expected');}},
 '../lib/node-trading':{
  getNodeTradeOperation:node=>state.operations[node.toLowerCase()]||null,
  refreshNodeTradeOperation:async node=>{const key=node.toLowerCase(),started=state.operations[key];state.refreshCalls++;state.refreshByNode[key]=(state.refreshByNode[key]||0)+1;state.activeRefreshes++;state.maxRefreshes=Math.max(state.maxRefreshes,state.activeRefreshes);try{if(state.hangReads)await new Promise(resolve=>state.hungResolvers.push(resolve));await new Promise(resolve=>setTimeout(resolve,node===state.slowNode?250:15));if(state.failNode===key&&state.failNodeCount>0){state.failNodeCount--;throw Error('Temporary status RPC failure');}const current=state.operations[key];if(!current)throw Error('No recorded trade exists for this node.');if((current.tokenAddress===PREVIOUS_TOKEN&&state.confirmPrevious)||(current.tokenAddress===TOKEN&&(state.confirmed||state.confirmedNodes.has(key))))state.operations[key]={...current,status:'confirmed',message:'Trade confirmed on Robinhood Chain. Refresh holdings for the latest balances.'};return state.operations[key].txHash===started.txHash?state.operations[key]:started;}finally{state.activeRefreshes--;}}
 },
 '../lib/pons-trade':{
  copyTradeAmount:value=>value,parseTradeAmount:()=>ethers.BigNumber.from(1),
  getNodeTradingSnapshot:async(token=TOKEN)=>{state.snapshotCalls++;if(state.holdSnapshots)await new Promise(resolve=>(state.snapshotResolvers||(state.snapshotResolvers=[])).push(resolve));if(state.snapshotFailures>0){state.snapshotFailures--;throw Error('Temporary holdings RPC failure');}return {tokenAddress:token,symbol:'TEST',decimals:18,totalSupplyRaw:'1000000000000000000000',phase:0,blockNumber:state.confirmed?101:100,phaseMessage:'Trading available',tradingAvailable:true,balances:nodes.map(node=>({nodeAddress:node,ethBalanceWei:'1000000000000000000',tokenBalanceRaw:state.confirmed?'1000000000000000000':'0',supplySharePercent:state.confirmed?'0.1':'0'}))};}
 },
 '../lib/node-trade-batch':{
  prepareNodeTradeBatch:async(current,token,side,assertCurrent)=>{assertCurrent();state.batchPrepares.push(side);const entries=nodes.map((node,index)=>{const existing=state.operations[node.toLowerCase()];return existing&&['pending','unknown'].includes(existing.status)?{nodeIndex:index,nodeAddress:node,status:'blocked',error:'Check the recorded transaction before another action.'}:{nodeIndex:index,nodeAddress:node,status:'ready',review:review(node,index,side)};});const ready=entries.filter(entry=>entry.status==='ready');return {tokenAddress:token,side,mode:'trades',entries,expiresAt:ready.length?Date.now()+30000:0,maxGasCostWei:String(ready.length*100000000000000),maxTotalEthWei:String(ready.length*100000000000000)};},
  executeNodeTradeBatch:async(current,batch,assertCurrent,onProgress)=>{assertCurrent();state.batchExecutes.push(batch.side);const results=[];for(const entry of batch.entries){if(entry.status!=='ready')continue;const op=operation(entry.nodeAddress,batch.side);state.operations[entry.nodeAddress.toLowerCase()]=op;const result={nodeIndex:entry.nodeIndex,nodeAddress:entry.nodeAddress,status:'submitted',operation:op};results.push(result);state.batchProgress=results.length;onProgress(result);if(state.holdBatch&&results.length===1)await new Promise(resolve=>window.releaseHeldBatch=resolve);assertCurrent();}return results;}
 }
};
const component={exports:{}};new Function('require','module','exports',${JSON.stringify(source)})(id=>modules[id]||(id.endsWith('.css')?{default:new Proxy({},{get:(_,key)=>String(key)})}:null),component,component.exports);
const root=ReactDOM.createRoot(document.getElementById('root')),balanceRefresh=()=>state.nodeBalanceCallbacks++;window.setAccountReadiness=value=>root.render(jsx(component.exports.default,{session,accountReadiness:value,launchedTokenAddress:TOKEN,onNodeBalancesRefresh:balanceRefresh}));window.setAccountReadiness(true);
window.test={state,replacePrevious:()=>{state.operations[nodes[0].toLowerCase()]=operation(nodes[0],'sell','pending',PREVIOUS_TOKEN,90);},confirmPrevious:()=>{state.confirmPrevious=true;},confirmFirst:()=>{state.confirmedNodes.add(nodes[0].toLowerCase());},normalSpeed:()=>{state.slowNode='';},confirmWithFailures:()=>{state.confirmed=true;state.slowNode=nodes[1];state.failNode=nodes[4].toLowerCase();state.failNodeCount=3;state.snapshotFailures=1;},prepareHeldRead:()=>{state.confirmed=false;state.confirmedNodes.clear();state.slowNode='';state.hangReads=true;},releaseHungReads:()=>{state.hangReads=false;state.hungResolvers.splice(0).forEach(resolve=>resolve());},holdBatch:()=>{state.holdBatch=true;},releaseBatch:()=>{state.holdBatch=false;window.releaseHeldBatch();},focus:()=>window.dispatchEvent(new Event('focus')),visible:()=>document.dispatchEvent(new Event('visibilitychange')),unmount:()=>root.unmount()};
`;
const html = '<!doctype html><style>body{margin:0}.spacer{height:700px}</style><div class="spacer"></div><div id="root"></div><script>' + ethersSource.replace(/<\/script/gi, '<\\/script') + '</script><script>' + setup.replace(/<\/script/gi, '<\\/script') + '</script>';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 720 } });
    const navigations = [], errors = [];
    await context.route('**/*', route => route.request().isNavigationRequest() ? (navigations.push(route.request().url()), route.fulfill({ status: 200, contentType: 'text/html', body: html })) : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:41924/');
    await page.getByRole('button', { name: 'Buy Max All Nodes', exact: true }).waitFor();
    await page.evaluate(()=>window.setAccountReadiness(false));
    assert.equal(await page.getByRole('button',{name:'Buy Max All Nodes',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:/Refresh all/}).isEnabled(),true);
    await page.evaluate(()=>window.setAccountReadiness(true));
    assert.equal(await page.getByText('Robinhood transaction pending', { exact: true }).count(), 1, 'A pending operation from another token is shown against the selected-token holdings');
    await page.getByLabel('PONS token address').fill('0xdead');
    assert.equal(await page.getByRole('button', { name: 'Buy Max All Nodes', exact: true }).count(), 0, 'Changing the token clears the stale holdings snapshot');
    const beforeNoSnapshotManual = await page.evaluate(() => test.state.nodeBalanceCallbacks);
    await page.waitForFunction(() => test.state.activeRefreshes === 1);
    await page.evaluate(() => { test.replacePrevious(); test.confirmPrevious(); test.focus(); test.visible(); });
    await page.getByRole('button', { name: /Refresh all/ }).click();
    await page.getByText('Transactions checked and node balance refresh requested.', { exact: true }).waitFor();
    await page.waitForFunction(value => test.state.nodeBalanceCallbacks > value, beforeNoSnapshotManual);
    assert.equal(await page.getByRole('button', { name: /Refresh all/ }).count(), 1, 'Manual transaction and node refresh remains available without token holdings');
    assert.equal(await page.evaluate(() => test.state.refreshByNode['0x0000000000000000000000000000000000000001']), 1, 'Focus and visibility join the in-flight previous-token status check');
    await page.evaluate(() => test.normalSpeed());
    await page.getByLabel('PONS token address').fill('0x2222222222222222222222222222222222222222');
    await page.getByRole('button', { name: 'Verify token and load holdings', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Max All Nodes', exact: true }).waitFor();
    await page.getByText('Trade confirmed on Robinhood Chain', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.body.textContent.includes('0x'+'90'.padStart(64,'0'))), 'A stale old-hash response cannot overwrite the newer stored operation');
    assert.equal(await page.getByText('0x3333333333333333333333333333333333333333', { exact: true }).count(), 1, 'Status refresh validates against the recorded operation token');
    await page.getByRole('button', { name: 'Buy Max All Nodes', exact: true }).scrollIntoViewIfNeeded();
    const beforeBuyScroll = await page.evaluate(() => scrollY);
    await page.evaluate(() => test.holdBatch());
    await page.getByRole('button', { name: 'Buy Max All Nodes', exact: true }).click();
    await page.waitForFunction(() => test.state.batchProgress === 1);
    await page.waitForFunction(() => test.state.refreshCalls >= 1);
    await page.evaluate(() => { test.confirmFirst(); test.focus(); });
    await page.getByLabel('All-node submission results').getByText('Node 1 · confirmed', { exact: true }).waitFor();
    assert.equal(await page.getByText(/Signing and submitting/).count(), 1, 'Read-only polling does not cancel an active batch');
    const beforeActiveManual = await page.evaluate(() => ({ snapshots: test.state.snapshotCalls, executes: test.state.batchExecutes.length }));
    await page.getByRole('button', { name: /Refresh all/ }).click();
    await page.waitForFunction(value => test.state.snapshotCalls > value, beforeActiveManual.snapshots);
    assert.equal(await page.evaluate(() => test.state.batchExecutes.length), beforeActiveManual.executes, 'Manual refresh joins the read cycle without replaying the active batch');
    assert.equal(await page.getByText(/Signing and submitting/).count(), 1, 'Manual refresh leaves the active write in progress');
    await page.evaluate(() => test.releaseBatch());
    await page.getByText(/Submitted.*awaiting confirmation/).first().waitFor();
    await page.waitForTimeout(50);
    const afterBuyScroll = await page.evaluate(() => scrollY);
    assert.equal(await page.getByText('Robinhood transaction pending', { exact: true }).count(), 4);
    assert.equal(await page.getByLabel('All-node submission results').getByText('Node 1 · confirmed', { exact: true }).count(), 1, 'Final batch completion cannot restore a pending copy over an early confirmed result');
    await page.getByRole('button', { name: 'Refresh all transactions & nodes', exact: true }).waitFor();
    const beforeReturnRefresh = await page.evaluate(() => ({ calls: test.state.refreshCalls, byNode: { ...test.state.refreshByNode } }));
    const beforeTerminalSnapshots = await page.evaluate(() => test.state.snapshotCalls);
    await page.evaluate(() => test.confirmWithFailures());
    await page.getByRole('button', { name: 'Refresh all transactions & nodes', exact: true }).click();
    await page.evaluate(() => { test.focus(); test.visible(); });
    await page.waitForFunction(() => test.state.activeRefreshes > 0 && Array.from(document.querySelectorAll('strong')).some(node => node.textContent === 'Trade confirmed on Robinhood Chain'));
    assert.ok(await page.evaluate(() => test.state.activeRefreshes > 0), 'Fast confirmations publish while a slower node status request is still active');
    assert.match(await page.locator('[role="status"]').filter({ hasText: /Checking transactions/ }).textContent(), /Checking transactions [1-3] of 4/, 'The shared refresh cycle reports bounded per-node progress');
    await page.waitForFunction(({ calls }) => test.state.refreshCalls >= calls + 4, beforeReturnRefresh);
    await page.getByRole('button', { name: 'Refresh all transactions & nodes', exact: true }).waitFor();
    const afterReturnRefresh = await page.evaluate(() => test.state.refreshCalls);
    console.log(JSON.stringify({ phase: 'coalescing', beforeReturnRefresh, afterReturnRefresh, byNode: await page.evaluate(() => test.state.refreshByNode) }));
    const afterByNode = await page.evaluate(() => test.state.refreshByNode);
    const addressKeys = Object.keys(afterByNode);
    assert.equal(afterByNode[addressKeys[0]] - (beforeReturnRefresh.byNode[addressKeys[0]] || 0), 0, 'Already confirmed nodes are not re-polled');
    assert.ok(addressKeys.slice(1, 4).every(key => afterByNode[key] - (beforeReturnRefresh.byNode[key] || 0) === 1), 'Focus and visibility do not duplicate checks for nodes completed by the joined cycle');
    assert.ok(afterByNode[addressKeys[4]] - (beforeReturnRefresh.byNode[addressKeys[4]] || 0) <= 3, 'Only the partially failed node is retried after the coalesced cycle');
    await page.getByText(/Refresh incomplete/).waitFor();
    assert.equal(await page.getByText('Trade confirmed on Robinhood Chain', { exact: true }).count(), 4, 'A partial RPC failure preserves the failed node and publishes four verified confirmations');
    await page.getByText('Trade confirmed on Robinhood Chain', { exact: true }).nth(4).waitFor({ timeout: 5000 });
    assert.ok(await page.evaluate(value => test.state.snapshotCalls >= value + 2, beforeTerminalSnapshots), 'A failed holdings read is retried after the last pending operation becomes terminal');
    assert.ok(await page.evaluate(() => test.state.maxRefreshes <= 3), 'Status refresh concurrency stays at three');
    await page.evaluate(() => test.normalSpeed());
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).click();
    await page.getByText('Trade confirmed on Robinhood Chain', { exact: true }).nth(4).waitFor({ timeout: 5000 });
    const observation = await page.evaluate(({ beforeBuyScroll, afterBuyScroll }) => ({ beforeBuyScroll, afterBuyScroll, ...test.state, navigationCount: performance.getEntriesByType('navigation').length }), { beforeBuyScroll, afterBuyScroll });
    const refreshAllCount = await page.getByRole('button', { name: /Refresh all/i }).count();
    const confirmedCount = await page.getByText('Trade confirmed on Robinhood Chain', { exact: true }).count();
    console.log(JSON.stringify({ phase: 'observation', observation, refreshAllCount, confirmedCount, navigations: navigations.length, errors }));
    assert.ok(observation.afterBuyScroll - observation.beforeBuyScroll < 100, 'Submitting Buy All must not jump the viewport to appended review details');
    assert.ok(observation.refreshCalls >= 6, 'Previous-token and selected-token pending transactions refresh automatically');
    assert.ok(observation.snapshotCalls >= 2, 'Confirmed operations must refresh holdings automatically');
    assert.equal(confirmedCount, 5, 'Confirmed receipts must unblock every node without five manual clicks');
    assert.equal(refreshAllCount, 1, 'The workspace must offer one manual Refresh All control');
    assert.deepEqual(await page.evaluate(() => test.state.batchExecutes), ['buy', 'sell']);
    await page.getByRole('button', { name: 'Refresh all transactions & nodes', exact: true }).waitFor();
    const beforeManual = await page.evaluate(() => ({ snapshots: test.state.snapshotCalls, callbacks: test.state.nodeBalanceCallbacks }));
    await page.getByRole('button', { name: 'Refresh all transactions & nodes', exact: true }).click();
    await page.waitForFunction(value => test.state.snapshotCalls > value, beforeManual.snapshots);
    const afterManual = await page.evaluate(() => ({ snapshots: test.state.snapshotCalls, callbacks: test.state.nodeBalanceCallbacks }));
    assert.equal(afterManual.snapshots, beforeManual.snapshots + 1, 'Manual Refresh All reads holdings once');
    assert.equal(afterManual.callbacks, beforeManual.callbacks + 1, 'Manual Refresh All requests the NodeManager balance refresh once');
    assert.equal(navigations.length, 1);
    await page.evaluate(() => test.prepareHeldRead());
    await page.getByRole('button', { name: 'Sell Max All Nodes', exact: true }).click();
    await page.waitForFunction(() => test.state.activeRefreshes === 3);
    await page.getByRole('button', { name: 'Refresh all transactions & nodes', exact: true }).waitFor({ timeout: 2000 });
    await page.evaluate(() => { test.focus(); test.visible(); });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => test.state.activeRefreshes), 3, 'Timed-out provider promises remain inside the shared three-read budget');
    await page.evaluate(() => test.unmount());
    await page.evaluate(() => test.releaseHungReads());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#root').textContent(), '', 'A held status response cannot publish after the wallet workspace unmounts');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, check: 'Buy All confirmations refresh status and holdings, keep viewport stable, and allow Sell All' }));
    const slowPage=await context.newPage();slowPage.on('pageerror',error=>errors.push(error.message));
    await slowPage.goto('http://localhost:41924/');await slowPage.getByRole('button',{name:'Buy Max All Nodes',exact:true}).waitFor();
    const snapshotBaseline=await slowPage.evaluate(()=>{test.state.holdSnapshots=true;return test.state.snapshotCalls;});
    for(let attempt=0;attempt<3;attempt++){
      await slowPage.getByRole('button',{name:attempt===0?'Refresh holdings':'Verify token and load holdings',exact:true}).click();
      await slowPage.getByText('Holdings refresh timed out.',{exact:true}).waitFor();
      assert.equal(await slowPage.getByLabel('PONS token address').isEnabled(),true,'snapshot timeout releases the loading UI');
    }
    assert.equal(await slowPage.evaluate(()=>test.state.snapshotCalls),snapshotBaseline+1,'manual retries join the still-running holdings snapshot');
    const changedToken='0x9999999999999999999999999999999999999999';await slowPage.getByLabel('PONS token address').fill(changedToken);
    await slowPage.evaluate(()=>{test.state.holdSnapshots=false;test.state.snapshotResolvers.splice(0).forEach(resolve=>resolve());});await slowPage.waitForTimeout(100);
    assert.equal(await slowPage.getByLabel('PONS token address').inputValue(),changedToken);
    assert.equal(await slowPage.getByRole('button',{name:'Buy Max All Nodes',exact:true}).count(),0,'late old snapshot cannot restore a cleared selection');
    assert.deepEqual(errors,[]);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
