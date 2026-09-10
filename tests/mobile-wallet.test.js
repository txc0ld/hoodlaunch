const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/mobile-wallet.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(`(function(module,exports){${js}\n})`, {})(moduleUnderTest, moduleUnderTest.exports);
const { hasInjectedWallet, HOODLABS_URL, METAMASK_DAPP_URL } = moduleUnderTest.exports;

test('mobile wallet links are fixed canonical URLs without forwarded browser state', () => {
  assert.equal(HOODLABS_URL, 'https://labs.hoodrich.rip/');
  assert.equal(METAMASK_DAPP_URL, 'https://metamask.app.link/dapp/labs.hoodrich.rip/');
  for (const value of [HOODLABS_URL, METAMASK_DAPP_URL]) {
    const url = new URL(value);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.doesNotMatch(value, /token|secret|session|auth/i);
  }
});

test('provider detection requires a callable injected request function', () => {
  assert.equal(hasInjectedWallet(null), false);
  assert.equal(hasInjectedWallet({}), false);
  assert.equal(hasInjectedWallet({ request: true }), false);
  assert.equal(hasInjectedWallet({ request() {} }), true);
});
