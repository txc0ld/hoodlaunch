const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function loadModules() {
  const cache = {};
  const injected = provider();
  function load(name) {
    if (cache[name]) return cache[name].exports;
    const module = { exports: {} }; cache[name] = module;
    const source = fs.readFileSync(path.join(__dirname, '../src/lib', name + '.ts'), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext('(function(require,module,exports){' + js + '\n})', { window: { ethereum: injected }, setTimeout, clearTimeout })(id => load(id.slice(2)), module, module.exports);
    return module.exports;
  }
  return { registry: load('wallet-provider').walletRegistry, connection: load('wallet-connection'), injected };
}
function provider() {
  const callbacks = new Map(); const removed = []; const calls = [];
  const state = { account: '0x1111111111111111111111111111111111111111', chain: '0x1237' };
  return { state, calls, removed, callbacks,
    request: async ({ method }) => { calls.push(method); if (method === 'eth_accounts') return [state.account]; if (method === 'eth_chainId') return state.chain; throw Error('Unexpected permission/signing method ' + method); },
    on(event, fn) { if (!callbacks.has(event)) callbacks.set(event, new Set()); callbacks.get(event).add(fn); },
    removeListener(event, fn) { removed.push([event, fn]); callbacks.get(event)?.delete(fn); },
    emit(event) { [...(callbacks.get(event) || [])].forEach(fn => fn()); },
  };
}
test('selection and disconnect permanently fence implicit injected fallback, including late tickets', () => {
  const { registry, injected } = loadModules(); const selected = provider();
  assert.equal(registry.getProvider(), injected);
  const ticket = registry.beginSelection(); assert.equal(registry.getProvider(), undefined);
  assert.equal(registry.select(selected, ticket), true); assert.equal(registry.getProvider(), selected);
  registry.disconnect(); assert.equal(registry.getProvider(), undefined);
  assert.equal(registry.select(selected, ticket), false);
});
test('listeners bind once, clean up, and reject queued callbacks from replaced providers', () => {
  const { registry } = loadModules(); const a = provider(); const b = provider(); let changes = 0;
  const off = registry.subscribe(() => changes++); const off2 = registry.subscribe(() => {});
  registry.select(a, registry.beginSelection());
  assert.equal(a.callbacks.get('disconnect').size, 1);
  const stale = [...a.callbacks.values()].flatMap(set => [...set]);
  registry.select(b, registry.beginSelection()); const version = registry.getVersion(); const count = changes;
  stale.forEach(fn => fn());
  assert.equal(registry.getVersion(), version); assert.equal(changes, count); assert.equal(registry.getProvider(), b);
  off(); assert.equal(b.callbacks.get('disconnect').size, 1); off2();
  for (const set of b.callbacks.values()) assert.equal(set.size, 0);
});
test('SDK candidate is inert until explicitly confirmed; confirmation never prompts or signs', async () => {
  const { registry, connection } = loadModules(); const selected = provider();
  const candidate = await connection.prepareWalletCandidate(selected, registry.beginSelection());
  assert.equal(registry.getProvider(), undefined);
  await connection.confirmWalletCandidate(candidate); assert.equal(registry.getProvider(), selected);
  assert.deepEqual(selected.calls, ['eth_accounts', 'eth_chainId', 'eth_accounts', 'eth_chainId']);
  for (const set of selected.callbacks.values()) assert.equal(set.size, 0);
  await assert.rejects(connection.confirmWalletCandidate(candidate), /changed/);
});
for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) test(`candidate ${event} invalidates confirmation, even after transient identity recovery`, async () => {
  const { registry, connection } = loadModules(); const selected = provider();
  const candidate = await connection.prepareWalletCandidate(selected, registry.beginSelection()); selected.emit(event);
  await assert.rejects(connection.confirmWalletCandidate(candidate), /changed/);
  assert.equal(registry.getProvider(), undefined); connection.discardWalletCandidate(candidate);
  for (const set of selected.callbacks.values()) assert.equal(set.size, 0);
});
test('disconnect during asynchronous candidate confirmation cannot reinstall provider', async () => {
  const { registry, connection } = loadModules(); const selected = provider();
  const candidate = await connection.prepareWalletCandidate(selected, registry.beginSelection());
  let release; selected.request = () => new Promise(resolve => { release = resolve; });
  const confirming = connection.confirmWalletCandidate(candidate); registry.disconnect();
  release([selected.state.account]); await new Promise(resolve => setImmediate(resolve)); release(selected.state.chain);
  await assert.rejects(confirming, /changed/); assert.equal(registry.getProvider(), undefined);
});
test('changed account without wallet event fails confirmation; unsupported chain remains represented honestly', async () => {
  const { registry, connection } = loadModules(); const selected = provider(); selected.state.chain = '0x89';
  const candidate = await connection.prepareWalletCandidate(selected, registry.beginSelection()); assert.equal(candidate.chainId, 137);
  selected.state.account = '0x2222222222222222222222222222222222222222';
  await assert.rejects(connection.confirmWalletCandidate(candidate), /changed/); assert.equal(registry.getProvider(), undefined);
});
test('timed out wallet reads settle and later results cannot assign authority', async () => {
  const { connection, registry } = loadModules(); let release;
  await assert.rejects(connection.boundedWalletRequest(new Promise(resolve => { release = resolve; }), 1), /timed out/);
  release('late'); assert.equal(registry.getSelection(), 0);
});
