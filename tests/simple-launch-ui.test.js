const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadLaunchpad() {
  const file = 'src/components/PonsLaunchpad.tsx';
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const marker = (name) => ({ default: () => React.createElement('div', { 'data-component': name }) });
  const modules = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    ethers: require('ethers'),
    './LabHero': marker('hero'),
    './NodeManager': marker('manager'),
    './NodeTrading': marker('trading'),
    './TokenLinks': marker('links'),
    './HolderFeeSharing': marker('holder-fees'),
    './PairSelector': marker('pair'),
    './MobileWalletConnect': marker('mobile-wallet'),
    './WalletConnection': marker('wallet-connection'),
    './TokenLab': {
      default: () => React.createElement('div', { 'data-component': 'simulator' }),
      PonsLaunchPlan: () => React.createElement('div', { 'data-component': 'pons-plan' }),
    },
    '../lib/pons': {
      getProtocolState: async () => { throw new Error('offline fixture'); },
      refreshWallet: async () => null,
      onWalletChange: () => () => {},
      getLaunchOperation: () => null,
      launchOperationKey: () => 'fixture',
      validateImageUri: () => {},
      PONS_EXPLORER: 'https://example.com',
    },
    '../lib/pons-holder-fees': {
      holderFeeLaunchBlocker: () => '', holderFeeLaunchDraft: (draft) => draft,
      rememberHolderFeeIntent: () => {}, preparedHolderFeeIntent: () => false,
      bindHolderFeeLaunch: () => null,
    },
    '../lib/pons-planning': {
      applyPonsPlan: (draft) => draft, getPonsPlanningSnapshot: () => null,
    },
    '../lib/node-vault': { forgetNodeSession: () => {} },
    '../lib/wallet-provider': { getWalletVersion: () => 0, walletRegistry: { getSelection: () => 0, disconnect: () => {} } },
    '../lib/wallet-connection': { boundedWalletRequest: (promise) => promise },
  };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (id) => id.endsWith('.css')
      ? { default: new Proxy({}, { get: (_, key) => String(key) }) }
      : modules[id] || marker(id),
  }, { filename: file });
  return module.exports.default;
}

const Launchpad = loadLaunchpad();
const account = React.createElement('section', { 'data-component': 'account' }, 'Account fixture');

function render(sessionIdentity, proEnabled = false) {
  return renderToStaticMarkup(React.createElement(Launchpad, {
    proPanel: account,
    sessionIdentity,
    proEnabled,
    generationEnabled: true,
    nodeTradingEnabled: true,
  }));
}

test('simple launch renders account, create, and wallets in workflow order without the generic simulator', () => {
  const html = render(null);
  const accountIndex = html.indexOf('data-component="account"');
  const launchIndex = html.indexOf('id="launch"');
  const walletsIndex = html.indexOf('id="wallet-workspace"');
  assert.ok(accountIndex >= 0 && accountIndex < launchIndex, 'account must render before create');
  assert.ok(launchIndex < walletsIndex, 'create must render before wallets');
  assert.doesNotMatch(html, /data-component="simulator"/);
  assert.match(html, /href="#pro-account"[^>]*><span>01<\/span>Account</);
  assert.ok(html.indexOf('href="#pro-account"') < html.indexOf('href="#launch"'));
  assert.ok(html.indexOf('href="#launch"') < html.indexOf('href="#wallet-workspace"'));
  assert.doesNotMatch(fs.readFileSync('src/components/TokenLab.tsx', 'utf8'), /#token-lab|Explore allocation and vesting simulations/);
});

test('upload affordance is visible for guests and enabled for signed-in Free and Pro accounts', () => {
  const guest = render(null);
  assert.match(guest, /Sign in to upload/);
  assert.doesNotMatch(guest, /aria-label="Choose token image"/);
  for (const [tier, html] of [['Free', render('a'.repeat(64))], ['Pro', render('b'.repeat(64), true)]]) {
    assert.match(html, /aria-label="Choose token image"/, tier);
    assert.match(html, /PNG, JPEG or WebP/, tier);
  }
});
