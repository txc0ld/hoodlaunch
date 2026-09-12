const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, overrides = {}, env = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, process: { env }, require: id => {
    if (id in overrides) return overrides[id];
    if (id === 'react' || id === 'react/jsx-runtime' || id === 'ethers') return require(id);
    if (id.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (id === './TokenLab') return { default: () => null, PonsLaunchPlan: () => null };
    if (id === '../lib/pons-holder-fees') return { holderFeeLaunchBlocker: () => '' };
    if (id === '../lib/pons-planning') return { getPonsPlanningSnapshot: () => null };
    return { default: () => null };
  }});
  return module.exports;
}
const marker = name => props => React.createElement('div', { 'data-component': name, 'data-finance': props.financeEnabled });
const Pons = load('src/components/PonsLaunchpad.tsx', { './NodeManager': { default: marker('manager') }, './NodeTrading': { default: marker('trading') } }).default;
const base = { generationEnabled: true, nodeTradingEnabled: true, sessionIdentity: 'a'.repeat(64), proEnabled: true, launchEnabled: false };
test('wallet trading flag is server-only, exact true and independent of launch', async () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', ' true ', 'true']) {
    const page = load('pages/index.tsx', {}, { NODE_GENERATION_ENABLED: 'true', NODE_TRADING_ENABLED: value, LIVE_LAUNCH_ENABLED: 'false', NEXT_PUBLIC_NODE_TRADING_ENABLED: 'true' });
    const { props } = await page.getServerSideProps();
    assert.equal(props.nodeTradingEnabled, value === 'true');
    assert.equal(props.launchEnabled, false);
    assert.equal(props.generationEnabled, true);
  }
});
test('actual component exposes safe discoverable states and isolates finance capability', () => {
  for (const generationEnabled of [false, true]) for (const nodeTradingEnabled of [false, true]) for (const sessionIdentity of [null, base.sessionIdentity]) for (const proEnabled of [false, true]) for (const launchEnabled of [false, true]) for (const financeEnabled of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Pons, { generationEnabled, nodeTradingEnabled, sessionIdentity, proEnabled, launchEnabled, financeEnabled }));
    const manager = generationEnabled && Boolean(sessionIdentity);
    const trading = manager && proEnabled && nodeTradingEnabled;
    assert.equal(html.includes('data-component="manager"'), manager);
    assert.equal(html.includes('data-component="trading"'), trading);
    if (manager) assert.equal(html.includes('data-finance="true"'), proEnabled && financeEnabled);
    assert.ok(html.includes('id="wallet-workspace"'));
    assert.ok(html.includes('href="#node-trading"'));
    if (!trading) assert.ok(html.includes('id="node-trading"'));
    if (trading) assert.ok(html.indexOf('id="launch"') < html.indexOf('data-component="trading"'));
    if (!generationEnabled || !nodeTradingEnabled) assert.ok(html.includes('Multi-wallet trading is currently unavailable'));
    else if (!sessionIdentity) assert.ok(html.includes('Sign in with Pro access'));
    else if (!proEnabled) assert.ok(html.includes('Multi-wallet trading requires Pro'));
  }
});
test('Hoodlaunch carries trading availability independently through account wrapper', () => {
  const Hood = load('src/hoodlaunch.tsx', { './components/PonsLaunchpad': { default: props => React.createElement('div', { 'data-trading': props.nodeTradingEnabled, 'data-launch': props.launchEnabled }) } }).default;
  const html = renderToStaticMarkup(React.createElement(Hood, { nodeTradingEnabled: true, launchEnabled: false }));
  assert.match(html, /data-trading="true"/);
  assert.match(html, /data-launch="false"/);
});

test('every capability flag is exact true and SSR keeps sales and finance independent', async () => {
 const flags={LIVE_LAUNCH_ENABLED:'launchEnabled',NODE_GENERATION_ENABLED:'generationEnabled',NODE_TRADING_ENABLED:'nodeTradingEnabled',PRO_SALES_ENABLED:'salesEnabled',NODE_FINANCE_ENABLED:'financeEnabled'};
 for(const [flag,prop] of Object.entries(flags)) for(const value of [undefined,'','false','TRUE','1',' true ','true']) {
  const env=Object.fromEntries(Object.keys(flags).map(key=>[key,'true']));
  env[flag]=value;env['NEXT_PUBLIC_'+flag]='true';
  const page=load('pages/index.tsx',{},env);const {props}=await page.getServerSideProps();
  for(const name of Object.values(flags)) assert.equal(props[name],name===prop?value==='true':true,flag+' -> '+name);
 }
 const {props}=await load('pages/index.tsx').getServerSideProps();
 for(const name of Object.values(flags)) assert.equal(props[name],false);
});
test('Home and account wrapper carry independent launch, sales and finance flags including defaults', () => {
 const attr=(props)=>({'data-launch':props.launchEnabled,'data-sales':props.salesEnabled,'data-finance':props.financeEnabled});
 const Home=load('pages/index.tsx',{'../src/hoodlaunch':{default:props=>React.createElement('div',attr(props))}}).default;
 const Hood=load('src/hoodlaunch.tsx',{
  './components/PonsLaunchpad':{default:props=>React.createElement('div',{'data-launch':props.launchEnabled,'data-finance':props.financeEnabled},props.proPanel)},
  './components/ProAccess':{default:props=>React.createElement('div',{'data-sales':props.salesEnabled})}
 }).default;
 for(const launchEnabled of [false,true]) for(const salesEnabled of [false,true]) for(const financeEnabled of [false,true]) {
  for(const Component of [Home,Hood]) {
   const html=renderToStaticMarkup(React.createElement(Component,{launchEnabled,salesEnabled,financeEnabled}));
   for(const [name,value] of Object.entries({launch:launchEnabled,sales:salesEnabled,finance:financeEnabled})) assert.ok(html.includes('data-'+name+'="'+value+'"'));
  }
 }
 const html=renderToStaticMarkup(React.createElement(Hood));
 assert.match(html,/data-launch="false"/);assert.match(html,/data-sales="false"/);assert.match(html,/data-finance="false"/);
});
