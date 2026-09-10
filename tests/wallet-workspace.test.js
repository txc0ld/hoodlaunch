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
  for (const generationEnabled of [false, true]) for (const nodeTradingEnabled of [false, true]) for (const sessionIdentity of [null, base.sessionIdentity]) for (const proEnabled of [false, true]) for (const launchEnabled of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Pons, { generationEnabled, nodeTradingEnabled, sessionIdentity, proEnabled, launchEnabled }));
    const manager = generationEnabled && Boolean(sessionIdentity);
    const trading = manager && proEnabled && nodeTradingEnabled;
    assert.equal(html.includes('data-component="manager"'), manager);
    assert.equal(html.includes('data-component="trading"'), trading);
    if (manager) assert.equal(html.includes('data-finance="true"'), proEnabled && launchEnabled);
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
