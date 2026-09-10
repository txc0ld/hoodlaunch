const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ethers = require('ethers');
const { utils, constants } = ethers;
const ACCOUNT = '0x' + '11'.repeat(20), TOKEN = '0x' + '22'.repeat(20), CURVE = '0x' + '33'.repeat(20), OTHER = '0x' + '44'.repeat(20), DISTRIBUTOR = '0x' + '55'.repeat(20);
const HASH = '0x' + 'ab'.repeat(32), BLOCK = '0x' + 'bc'.repeat(32);
const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const runtime = require('./fixtures/pons-holder-fees-observed-runtime.json');
const launchRuntime = require('./fixtures/pons-trade-runtime.json').contracts[FACTORY.toLowerCase()];
function harness() {
  const state = { account: ACCOUNT, chain: '0x1237', version: 0, active: true, calls: [], rpc: [], mapping: constants.AddressZero, recipient: ACCOUNT, head: 101, removed: false };
  const ethereum = { async request({ method }) { state.calls.push(method); if (method === 'eth_accounts') return state.account ? [state.account] : []; if (method === 'eth_chainId') return state.chain; throw Error('Unexpected wallet method ' + method); } };
  state.provider = ethereum;
  let core, readAbi, launchAbi;
  function event(values = {}) { return { address: state.logAddress || FACTORY, ...launchAbi.encodeEventLog(launchAbi.getEvent('TokenLaunched'), [values.token || TOKEN, CURVE, ACCOUNT, constants.AddressZero, 0, 42]) }; }
  async function touch(method) { state.rpc.push(method); if (state.hook) await state.hook(method); }
  class Provider {
    async getBlockNumber() { await touch('head'); return state.head; }
    async getBlock(n) { await touch('block'); state.blocks = (state.blocks || 0) + 1; return { hash: state.reorg && state.blocks > 2 ? HASH : BLOCK }; }
    async getTransactionReceipt() { await touch('receipt'); return state.noReceipt ? null : { status: 1, from: ACCOUNT, transactionHash: HASH, blockNumber: 100, blockHash: BLOCK, logs: [event({ token: state.logToken })], ...state.receipt }; }
    async getCode(address) { await touch('code'); if (state.badCode && address.toLowerCase() === state.badCode.toLowerCase()) return '0x00'; if (address.toLowerCase() === FACTORY.toLowerCase()) return launchRuntime; if (address.toLowerCase() === core.HOLDER_FACTORY.toLowerCase()) return runtime.proxyRuntime; if (address.toLowerCase() === core.HOLDER_IMPLEMENTATION.toLowerCase()) return runtime.implementationRuntime; return state.emptyDistributor ? '0x' : '0x6000'; }
    async getStorageAt(address, slot, block) { await touch('slot'); assert.equal(address, core.HOLDER_FACTORY); assert.equal(slot, core.IMPLEMENTATION_SLOT); assert.equal(block, state.head); return state.slot || utils.hexZeroPad(core.HOLDER_IMPLEMENTATION, 32); }
    async call(tx, block) {
      await touch('call'); assert.equal(block, state.head);
      const parsed = readAbi.parseTransaction(tx); assert.equal(parsed.args[0], TOKEN);
      if (parsed.name === 'distributorOf') { assert.equal(tx.to, core.HOLDER_FACTORY); return state.rawMapping || readAbi.encodeFunctionResult(parsed.name, [state.mapping]); }
      assert.equal(tx.to, FACTORY);
      return readAbi.encodeFunctionResult(parsed.name, [[state.token || TOKEN, state.curve || CURVE, state.deployer || ACCOUNT, state.recipient, constants.AddressZero, 42, 100, 60, 0, false, 0, 0, 0, 0, state.exists !== false]]);
    }
    removeAllListeners() { state.removed = true; }
  }
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const filename = path.resolve('src/lib/' + name + '.ts');
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const req = id => id === 'ethers' ? { ...ethers, providers: { ...ethers.providers, Web3Provider: Provider } } : id === './pons' ? { PONS_CHAIN_ID: 4663, PONS_FACTORY: FACTORY } : id === './wallet-provider' ? { getWalletProvider: () => state.provider, getWalletVersion: () => state.version } : id.startsWith('./') ? load(id.slice(2)) : require(id);
    vm.runInNewContext(code, { exports: module.exports, module, require: req, setTimeout: (fn, ms) => state.timeout ? (queueMicrotask(fn), 0) : setTimeout(fn, ms), clearTimeout }, { filename });
    return cache[name] = module.exports;
  }
  core = load('pons-holder-fees'); readAbi = new utils.Interface(core.HOLDER_READ_ABI); launchAbi = new utils.Interface(load('pons-abi').FACTORY_ABI);
  const receipt = { transactionHash: HASH, tokenAddress: TOKEN, curveAddress: CURVE, explorerUrl: 'https://example.test/tx/' + HASH };
  const wallet = { account: ACCOUNT, chainId: 4663, balanceWei: '0', canLaunch: true };
  const inspect = () => core.inspectHolderFees(receipt, wallet, () => { if (!state.active) throw Error('cancelled'); });
  return { core, state, receipt, wallet, inspect };
}
test('holder preference preserves normal recipient, forces connected launch account, and blocks requested launch', () => {
  const { core } = harness(); const draft = { creatorFeeRecipient: OTHER };
  assert.equal(core.holderFeeLaunchDraft(draft, false, ACCOUNT).creatorFeeRecipient, OTHER);
  assert.equal(core.holderFeeLaunchDraft(draft, true, ACCOUNT).creatorFeeRecipient, ACCOUNT);
  assert.equal(draft.creatorFeeRecipient, OTHER);
  assert.equal(core.holderFeeLaunchBlocker(false), ''); assert.match(core.holderFeeLaunchBlocker(true), /unavailable/);
  assert.throws(() => core.holderFeeLaunchDraft(draft, true, constants.AddressZero));
});
test('prepared intent is identity-bound, immutable and bound to the actual returned token/hash', () => {
  const { core, receipt } = harness(); const prepared = { account: ACCOUNT, creatorFeeRecipient: ACCOUNT };
  core.rememberHolderFeeIntent(prepared, true);
  assert.throws(() => core.rememberHolderFeeIntent(prepared, false), /new review/);
  assert.throws(() => core.preparedHolderFeeIntent({ ...prepared }), /missing/);
  const bound = core.bindHolderFeeLaunch(prepared, receipt);
  assert.equal(bound.token, TOKEN); assert.equal(bound.transactionHash, HASH); assert.equal(bound.requested, true); assert(Object.isFrozen(bound));
  assert.throws(() => core.rememberHolderFeeIntent({ ...prepared, creatorFeeRecipient: OTHER }, true), /initial fee recipient/);
});
test('both live-disabled and live-enabled setup always fail without touching a wallet', async () => {
  const h = harness();
  await assert.rejects(h.core.enableHolderFees(false), /Live launching/);
  await assert.rejects(h.core.enableHolderFees(true), /verification is incomplete/);
  assert.deepEqual(h.state.calls, []); assert.deepEqual(h.state.rpc, []);
});
for (const [mapping, recipient, expected] of [[constants.AddressZero, ACCOUNT, 'not-created'], [DISTRIBUTOR, ACCOUNT, 'distributor-unverified'], [DISTRIBUTOR, DISTRIBUTOR, 'routing-unverified']]) {
  test('canonical read reports only observation: ' + expected, async () => {
    const h = harness(); Object.assign(h.state, { mapping, recipient }); const result = await h.inspect();
    assert.equal(result.status, expected); assert.equal(result.setupAvailable, false); assert.equal(result.blockNumber, 101); assert(Object.isFrozen(result));
    assert.equal(result.callerIsRecipient, recipient === ACCOUNT); assert(h.state.calls.every(v => ['eth_accounts', 'eth_chainId'].includes(v))); assert(h.state.removed);
  });
}
for (const [label, change] of [
  ['wrong chain', h => h.state.chain = '0x1'], ['wrong account', h => h.state.account = OTHER], ['disconnected', h => h.state.provider = undefined],
  ['unconfirmed receipt', h => h.state.head = 100], ['failed receipt', h => h.state.receipt = { status: 0 }], ['receipt missing', h => h.state.noReceipt = true],
  ['foreign receipt hash', h => h.state.receipt = { transactionHash: BLOCK }], ['foreign receipt account', h => h.state.receipt = { from: OTHER }], ['noncanonical receipt', h => h.state.receipt = { blockHash: HASH }],
  ['wrong event factory', h => h.state.logAddress = OTHER], ['wrong event token', h => h.state.logToken = OTHER], ['missing launch mapping', h => h.state.exists = false],
  ['wrong mapped token', h => h.state.token = OTHER], ['wrong curve', h => h.state.curve = OTHER], ['wrong launch deployer', h => h.state.deployer = OTHER],
  ['zero recipient', h => h.state.recipient = constants.AddressZero], ['wrong launch runtime', h => h.state.badCode = FACTORY], ['wrong proxy runtime', h => h.state.badCode = h.core.HOLDER_FACTORY],
  ['wrong implementation runtime', h => h.state.badCode = h.core.HOLDER_IMPLEMENTATION], ['changed implementation slot', h => h.state.slot = utils.hexZeroPad(OTHER, 32)],
  ['dirty implementation slot padding', h => h.state.slot = '0x' + 'ff'.repeat(12) + h.core.HOLDER_IMPLEMENTATION.slice(2)],
  ['invalid mapping return', h => h.state.rawMapping = '0x00'], ['empty mapped distributor', h => { h.state.mapping = DISTRIBUTOR; h.state.emptyDistributor = true; }], ['snapshot reorg', h => h.state.reorg = true],
]) test(label + ' fails closed without a send', async () => {
  const h = harness(); change(h); await assert.rejects(h.inspect()); assert(h.state.calls.every(v => ['eth_accounts', 'eth_chainId'].includes(v)));
});
for (const stage of ['receipt', 'head', 'block', 'code', 'slot', 'call']) {
  for (const kind of ['cancel', 'provider', 'epoch', 'account', 'chain']) test(`${kind} change during ${stage} discards observation`, async () => {
    const h = harness(); let changed = false;
    h.state.hook = async method => { if (method !== stage || changed) return; changed = true; if (kind === 'cancel') h.state.active = false; if (kind === 'provider') h.state.provider = {}; if (kind === 'epoch') h.state.version++; if (kind === 'account') h.state.account = OTHER; if (kind === 'chain') h.state.chain = '0x1'; };
    await assert.rejects(h.inspect()); assert(h.state.calls.every(v => ['eth_accounts', 'eth_chainId'].includes(v)));
  });
}
test('duplicate checks are excluded; failed lookup can be retried with fresh chain state', async () => {
  const h = harness(); let release, entered; const gate = new Promise(r => release = r), ready = new Promise(r => entered = r);
  h.state.hook = async method => { if (method === 'receipt') { entered(); await gate; } };
  const first = h.inspect(); await ready; await assert.rejects(h.inspect(), /already running/); release(); await first;
  h.state.hook = undefined; h.state.badCode = h.core.HOLDER_FACTORY; await assert.rejects(h.inspect());
  h.state.badCode = undefined; h.state.mapping = DISTRIBUTOR; h.state.recipient = DISTRIBUTOR;
  assert.equal((await h.inspect()).status, 'routing-unverified');
});
test('UI invalidates review on toggle and guards both preparation and execution with trust blocker', () => {
  const source = fs.readFileSync('src/components/PonsLaunchpad.tsx', 'utf8');
  assert.match(source, /invalidateReview\(\); setHolderFeesRequested\(event.target.checked\)/);
  assert.match(source, /if \(!launchEnabled \|\| holderFeeLaunchBlocker\(holderFeesRequested\)\) return/);
  assert.match(source, /holderFeeLaunchBlocker\(preparedHolderFeeIntent\(prepared\)\)/);
  assert.match(source, /!holderFeesRequested && <label[^\n]+Fee recipient/);
  assert.match(source, /setReceipt\(result\)[\s\S]*?try \{ setHolderFeeBinding/);
});

test('timed-out lookup releases latch and late reads cannot report success', async () => {
  const h = harness(); h.state.timeout = true;
  h.state.hook = async method => { if (method === 'receipt') await new Promise(() => {}); };
  await assert.rejects(h.inspect(), /timed out/); assert(h.state.removed);
  h.state.timeout = false; h.state.hook = undefined; assert.equal((await h.inspect()).status, 'not-created');
});
