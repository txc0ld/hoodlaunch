const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ethers = require('ethers');
const { utils, BigNumber: BN, constants } = ethers;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const CURVE = '0x4444444444444444444444444444444444444444';
const HASH = '0x' + 'ab'.repeat(32);
const PIN = '0x' + '12'.repeat(32);
function harness(lockState = { held: false }, browserTransform = false) {
  const state = { chainId: 4663, account: ACCOUNT, eligible: true, enabled: true, fee: BN.from('500000000000000'), cap: 1000, pin: PIN, gas: BN.from(100000), gasPrice: BN.from(100), balance: utils.parseEther('1000'), quote: BN.from('900719925474099312345'), sends: [], calls: [], walletCalls: [], now: 1000 };
  const locks = { request: async (name, options, callback) => {
    assert.equal(name, 'pons-v2:launch-operation'); assert.equal(options.mode, 'exclusive'); assert.equal(options.ifAvailable, true);
    if (lockState.held) return callback(null);
    lockState.held = true;
    try { return await callback({ name }); } finally { lockState.held = false; }
  } };
  const cache = {};
  const ethereum = { request: async ({ method, params }) => { state.walletCalls.push(method); if (method === 'eth_accounts' || method === 'eth_requestAccounts') return state.account ? [state.account] : []; if (method === 'eth_chainId') return utils.hexValue(state.chainId); if (method === 'eth_sendTransaction') { state.sends.push(params[0]); if (state.sendError) throw state.sendError; return state.returnedHash === undefined ? HASH : state.returnedHash; } throw Error(method); } };
  function load(name) {
    if (cache[name]) return cache[name];
    const file = path.join(__dirname, '../src/lib', name + '.ts');
    const source = fs.readFileSync(file, 'utf8');
    let js;
    if (browserTransform) {
      const { getLoaderSWCOptions } = require('next/dist/build/swc/options');
      const options = getLoaderSWCOptions({ filename: file, development: false, isServer: false, isServerLayer: false, pagesDir: path.join(__dirname, '../src/pages'), isPageFile: false, hasReactRefresh: false, nextConfig: {}, jsConfig: {} });
      options.module = { type: 'commonjs' }; options.jsc.externalHelpers = false;
      js = require('next/dist/build/swc').transformSync(source, { ...options, filename: file }).code;
    } else js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: {} };
    const customRequire = id => id === 'ethers' ? { ...ethers, providers: { ...ethers.providers, Web3Provider: MockProvider, JsonRpcProvider: MockProvider } } : id.startsWith('./') ? load(id.replace('./', '')) : require(id);
    vm.runInNewContext('(function(require,module,exports){' + js + '\n})', { window: { ethereum }, navigator: { get locks() { return state.noLocks ? undefined : locks; } }, URL, Date: { now: () => state.now }, Error, console, Uint8Array, setTimeout: (callback, ms) => { if (state.forceTimeout) { queueMicrotask(callback); return 0; } return setTimeout(callback, ms); }, clearTimeout })(customRequire, module, module.exports);
    return cache[name] = module.exports;
  }
  const abis = load('pons-abi');
  const factory = new utils.Interface(abis.FACTORY_ABI);
  const router = new utils.Interface(abis.ROUTER_ABI);
  let core;
  function eventLog(overrides = {}) {
    const values = [TOKEN, CURVE, ACCOUNT, constants.AddressZero, 0, utils.parseEther('4.2')];
    for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
    return { address: core.PONS_FACTORY, ...factory.encodeEventLog(factory.getEvent('TokenLaunched'), values) };
  }
  function receipt(tx) { return { status: 1, transactionHash: HASH, from: ACCOUNT, to: tx.to, logs: [eventLog()], ...state.receipt }; }
  class MockProvider {
    async send(method) { assert.equal(method, 'eth_chainId'); return utils.hexValue(state.chainId); }
    removeAllListeners() { state.listenersRemoved = true; }
    async getCode() { return state.code === undefined ? '0x1234' : state.code; }
    async getBalance() { return state.balance; }
    async getGasPrice() { return state.gasPrice; }
    async estimateGas(tx) { state.estimated = tx; return state.gas; }
    async call(tx) {
      state.calls.push(tx);
      const abi = tx.to.toLowerCase() === core.PONS_ROUTER.toLowerCase() ? router : factory;
      const decoded = abi.parseTransaction(tx);
      if (state.onCall) await state.onCall(decoded);
      let result;
      switch (decoded.name) {
        case 'launchConfigCount': result = [1]; break;
        case 'getLaunchConfig': result = [[utils.parseEther('1000000000'), 100, utils.parseEther('1.68'), utils.parseEther('4.2'), 0, 60, state.enabled]]; break;
        case 'launchFee': result = [state.fee]; break;
        case 'maxCreatorTaxBps': result = [state.cap]; break;
        case 'canLaunch': result = [state.eligible]; break;
        case 'previewLaunchEconomics': result = [state.pin]; break;
        case 'launchToken': case 'launchAndBuy':
          if (state.simulationError) throw state.simulationError;
          result = decoded.name === 'launchAndBuy' ? [TOKEN, CURVE, state.quote] : [TOKEN, CURVE]; break;
        default: throw Error(decoded.name);
      }
      return abi.encodeFunctionResult(decoded.name, result);
    }
    async getTransactionReceipt(hash) {
      assert.equal(hash, HASH);
      const tx = state.sends[0];
      if (state.wait) return state.wait(tx, receipt(tx));
      return receipt(tx);
    }
    getSigner() { throw Error('Signer API must not delay hash reporting.'); }

  }
  core = load('pons');
  const wallet = { account: ACCOUNT, chainId: 4663, balanceWei: state.balance.toString(), canLaunch: true };
  const draft = { name: 'Test', symbol: 'TEST', description: 'A launch', logo: 'ipfs://bafyexample', twitter: '', telegram: '', website: 'https://example.com', discord: '', farcaster: '', configId: '0', developerBuyEth: '0', creatorFeeRecipient: '', creatorTaxBps: 0, buybackEnabled: false, slippageBps: 100, exemptions: [] };
  return { core, state, draft, wallet, factory, router, eventLog };
}
test('public protocol reads canonical chain and live config without wallet requests', async () => {
  const h = harness(); const result = await h.core.getProtocolState();
  assert.equal(result.chainId, 4663); assert.equal(result.launchFeeWei, h.state.fee.toString()); assert.equal(result.configs[0].graduationThresholdWei, utils.parseEther('4.2').toString());
  assert.equal(result.snipeWindowSeconds, undefined); assert.equal(h.state.walletCalls.length, 0); assert.equal(h.state.sends.length, 0);
});
test('refresh is silent; connect is the only account permission prompt', async () => {
  const h = harness(); await h.core.refreshWallet(); assert(!h.state.walletCalls.includes('eth_requestAccounts'));
  await h.core.connectWallet(); assert(h.state.walletCalls.includes('eth_requestAccounts'));
});
test('direct launch is simulated, frozen, fee-only and has one explicit send', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  assert.equal(h.state.sends.length, 0); assert(Object.isFrozen(p)); assert(Object.isFrozen(p.transaction));
  assert.equal(p.transaction.to, h.core.PONS_FACTORY); assert.equal(p.totalValueWei, h.state.fee.toString());
  const decoded = h.factory.parseTransaction(p.transaction); assert.equal(decoded.args.params.creatorFeeRecipient, ACCOUNT); assert.equal(decoded.args.params.salt, p.salt); assert.equal(utils.arrayify(p.salt).length, 32);
  const hashes = []; const receipt = await h.core.executePreparedLaunch(p, h.wallet, hash => hashes.push(hash));
  assert.equal(receipt.tokenAddress, TOKEN); assert.deepEqual(hashes, [HASH]); assert.equal(h.state.sends.length, 1);
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), /already submitted/);
});
test('atomic buy uses exact wei and a strictly positive integer slippage floor', async () => {
  const h = harness(); h.draft.developerBuyEth = '0.123456789012345678'; h.draft.slippageBps = 137;
  const p = await h.core.prepareLaunch(h.draft, h.wallet);
  assert.equal(p.minTokensOut, h.state.quote.mul(9863).div(10000).toString());
  assert.equal(p.totalValueWei, h.state.fee.add('123456789012345678').toString());
  const launches = h.state.calls.filter(c => c.to === h.core.PONS_ROUTER).map(c => h.router.parseTransaction(c));
  assert.equal(launches.length, 2); assert(launches[0].args.minTokensOut.isZero()); assert(launches[1].args.minTokensOut.gt(0));
  assert.equal(launches[0].args.params.salt, launches[1].args.params.salt); assert.equal(launches[1].args.recipient, ACCOUNT); assert.equal(h.state.sends.length, 0);
});
test('rejects zero minimum token output', async () => { const h = harness(); h.draft.developerBuyEth = '0.1'; h.state.quote = BN.from(1); await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /too small/); assert.equal(h.state.sends.length, 0); });
test('invalid inputs never reach a send', async () => {
  for (const fields of [{ developerBuyEth: '-1' }, { developerBuyEth: '1e-3' }, { developerBuyEth: '0.0000000000000000001' }, { logo: 'blob:test' }, { logo: 'data:image/png,x' }, { website: 'javascript:alert(1)' }, { creatorFeeRecipient: constants.AddressZero }, { creatorTaxBps: 1001 }, { exemptions: Array(33).fill(ACCOUNT) }, { slippageBps: 10000 }]) {
    const h = harness(); Object.assign(h.draft, fields); await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet)); assert.equal(h.state.sends.length, 0);
  }
});
test('chain, account, eligibility, config and balance checks fail closed', async () => {
  for (const state of [{ chainId: 1 }, { account: OTHER }, { eligible: false }, { enabled: false }, { balance: BN.from(0) }, { code: '0x' }]) {
    const h = harness(); Object.assign(h.state, state); await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet)); assert.equal(h.state.sends.length, 0);
  }
});
test('async draft mutations cannot alter the reviewed payload', async () => {
  const h = harness(); h.state.onCall = async decoded => { if (decoded.name === 'launchFee') { h.draft.configId = '42'; h.draft.slippageBps = 10000; h.draft.name = 'Changed'; } };
  const p = await h.core.prepareLaunch(h.draft, h.wallet); assert.equal(p.configId, '0'); assert.equal(p.name, 'Test');
});
test('prepared values cannot be forged by copying a review', async () => { const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); await assert.rejects(h.core.executePreparedLaunch({ ...p }, h.wallet), /unavailable/); assert.equal(h.state.sends.length, 0); });
test('execution rechecks stale time, account, chain, fee, economics, config, gate and gas', async () => {
  for (const state of [{ now: 122000 }, { chainId: 1 }, { account: OTHER }, { fee: BN.from(1) }, { pin: '0x' + '34'.repeat(32) }, { enabled: false }, { eligible: false }, { gasPrice: BN.from(1000) }, { gas: BN.from(200000) }]) {
    const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); Object.assign(h.state, state);
    await assert.rejects(h.core.executePreparedLaunch(p, h.wallet)); assert.equal(h.state.sends.length, 0);
  }
});
test('last-moment chain switch during simulation prevents sending', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); h.state.onCall = async decoded => { if (decoded.name === 'launchToken') h.state.chainId = 1; };
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), /Switch/); assert.equal(h.state.sends.length, 0);
});
test('execution simulation errors are decoded and never automatically retried', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  h.state.simulationError = { code: 'CALL_EXCEPTION', data: utils.id('SlippageExceeded()').slice(0, 10) };
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), /minimum price/); assert.equal(h.state.sends.length, 0);
});
test('receipt requires status, factory emitter and matching event values', async () => {
  for (const change of [h => ({ status: 0 }), h => ({ logs: [] }), h => ({ logs: [{ ...h.eventLog(), address: OTHER }] }), h => ({ logs: [h.eventLog({ 2: OTHER })] }), h => ({ logs: [h.eventLog({ 3: OTHER })] }), h => ({ logs: [h.eventLog({ 4: 1 })] }), h => ({ logs: [h.eventLog({ 0: OTHER })] })]) {
    const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); h.state.receipt = change(h); await assert.rejects(h.core.executePreparedLaunch(p, h.wallet)); assert.equal(h.state.sends.length, 1);
  }
});
test('concurrent confirmations cannot produce duplicate transactions', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  const result = await Promise.allSettled([h.core.executePreparedLaunch(p, h.wallet), h.core.executePreparedLaunch(p, h.wallet)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(h.state.sends.length, 1);
});
test('unknown submission or receipt failures block further launch attempts', async () => {
  for (const duringSend of [true, false]) {
    const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
    if (duringSend) h.state.sendError = { code: 'NETWORK_ERROR' }; else h.state.wait = async () => { throw { code: 'TIMEOUT' }; };
    await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), /uncertain/);
    await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /pending|unknown/); assert.equal(h.state.sends.length, 1);
  }
});
test('wallet rejection consumes review but permits preparing a fresh review', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); h.state.sendError = { code: 4001 };
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), /rejected/); await h.core.prepareLaunch(h.draft, h.wallet);
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), /already submitted/);
});
test('unverified replacement and cancellation error receipts remain unknown', async () => {
  for (const mode of ['repriced', 'cancelled', 'altered']) {
    const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
    h.state.wait = async (tx, receipt) => { throw { code: 'TRANSACTION_REPLACED', reason: 'repriced', cancelled: mode === 'cancelled', receipt, replacement: { ...tx, from: ACCOUNT, value: BN.from(tx.value), hash: HASH, data: mode === 'altered' ? '0x' : tx.data } }; };
    await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), e => e.submissionState === 'unknown');
    await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /pending|unknown/);
    assert.equal(h.state.sends.length, 1);
  }
});
test('broadcast display callback cannot prevent receipt tracking', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  assert.equal((await h.core.executePreparedLaunch(p, h.wallet, () => { throw Error('UI'); })).tokenAddress, TOKEN);
});

test('receipt timeout preserves unknown state and stops provider listeners', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  h.state.forceTimeout = true; h.state.wait = () => new Promise(() => {});
  const hashes = [];
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet, hash => hashes.push(hash)), /uncertain/);
  assert.deepEqual(hashes, [HASH]); assert.equal(h.state.listenersRemoved, true);
  await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /pending|unknown/);
  assert.equal(h.state.sends.length, 1);
});
test('public RPC on a different chain fails before reading protocol contracts', async () => {
  const h = harness(); h.state.chainId = 1;
  await assert.rejects(h.core.getProtocolState(), /4663/);
  assert.equal(h.state.calls.length, 0);
});

test('postbroadcast rejection codes and arbitrary error receipts cannot release pending state', async () => {
  for (const error of [{ code: 4001 }, { code: 'ACTION_REJECTED' }, { code: 'NETWORK_ERROR', receipt: { status: 0, transactionHash: HASH } }]) {
    const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
    h.state.wait = async () => { throw error; };
    await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), e => e.submissionState === 'unknown' && !e.message.includes('No launch was submitted'));
    await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /pending|unknown/);
    assert.equal(h.state.sends.length, 1);
  }
});
test('mismatched or malformed receipt identities and status retain pending lock', async () => {
  for (const patch of [{ transactionHash: '0x' + 'cc'.repeat(32) }, { transactionHash: undefined }, { from: OTHER }, { to: OTHER }, { status: undefined }, { status: 2 }, { transactionHash: '0x' + 'cc'.repeat(32), status: 0 }]) {
    const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); h.state.receipt = patch;
    await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), e => e.submissionState === 'unknown');
    await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /pending|unknown/);
  }
});
test('only directly retrieved matching failed receipt reports reverted and releases lock', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); h.state.receipt = { status: 0 };
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), e => e.submissionState === 'reverted');
  await h.core.prepareLaunch(h.draft, h.wallet);
});
test('submitting callback runs after validations and before send; failure sends nothing', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); let called = 0;
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet, undefined, () => { called++; assert.equal(h.state.sends.length, 0); throw Error('Storage unavailable'); }), e => e.submissionState === 'not-submitted');
  assert.equal(called, 1); assert.equal(h.state.sends.length, 0);
  await h.core.executePreparedLaunch(p, h.wallet, undefined, () => { called++; assert.equal(h.state.sends.length, 0); });
  assert.equal(called, 2); assert.equal(h.state.sends.length, 1);
});
test('hash callback arrives before any receipt lookup without transaction indexing', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); const order = [];
  h.state.wait = async (tx, receipt) => { order.push('receipt'); return receipt; };
  await h.core.executePreparedLaunch(p, h.wallet, hash => { assert.equal(hash, HASH); order.push('hash'); }, () => order.push('submitting'));
  assert.deepEqual(order, ['submitting', 'hash', 'receipt']);
  const tx = h.state.sends[0]; assert.equal(tx.from, ACCOUNT); assert.equal(tx.chainId, '0x1237'); assert.equal(tx.data, p.transaction.data); assert(BN.from(tx.gas).eq(p.transaction.gasLimit));
});
test('invalid wallet hash is unknown and never announced as a real hash', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); h.state.returnedHash = 'invalid'; let called = false;
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet, () => { called = true; }), e => e.submissionState === 'unknown');
  assert.equal(called, false); await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /pending|unknown/);
});
test('normal description paragraphs preserve CR/LF while unsafe control characters fail', async () => {
  const h = harness(); h.draft.description = 'First paragraph.\r\n\r\nSecond paragraph.';
  const p = await h.core.prepareLaunch(h.draft, h.wallet);
  assert.equal(h.factory.parseTransaction(p.transaction).args.params.description, h.draft.description);
  h.draft.description = 'Bad\x01control'; await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /control/);
});

test('origin-global Web Lock excludes independent tabs until receipt processing ends', async () => {
  const lock = { held: false }; const a = harness(lock); const b = harness(lock);
  const pa = await a.core.prepareLaunch(a.draft, a.wallet); const pb = await b.core.prepareLaunch(b.draft, b.wallet);
  let release, entered; const gate = new Promise(resolve => { release = resolve; }); const ready = new Promise(resolve => { entered = resolve; });
  a.state.wait = async (_, receipt) => { entered(); await gate; return receipt; };
  const first = a.core.executePreparedLaunch(pa, a.wallet); await ready;
  let callbackCalled = false;
  await assert.rejects(b.core.executePreparedLaunch(pb, b.wallet, undefined, () => { callbackCalled = true; }), error => error.submissionState === 'unknown');
  assert.equal(callbackCalled, false); assert.equal(b.state.sends.length, 0); assert.equal(lock.held, true);
  release(); await first; assert.equal(lock.held, false); assert.equal(a.state.sends.length, 1);
});
test('missing browser Web Locks fails closed before preflight, persistence and send', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet); const reads = h.state.calls.length; h.state.noLocks = true;
  let callbackCalled = false;
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet, undefined, () => { callbackCalled = true; }), error => error.submissionState === 'not-submitted' && /Web Locks/.test(error.message));
  assert.equal(callbackCalled, false); assert.equal(h.state.calls.length, reads); assert.equal(h.state.sends.length, 0);
});
test('existing durable marker detected inside lock preserves unknown outcome and sends nothing', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet, undefined, () => { throw new h.core.PonsSubmissionError('Existing marker', 'unknown'); }), error => error.submissionState === 'unknown');
  assert.equal(h.state.sends.length, 0);
  await assert.rejects(h.core.prepareLaunch(h.draft, h.wallet), /pending|unknown/);
});

test('lower fresh gas estimate cannot hide a higher actual transmitted gas allowance', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  assert.equal(p.transaction.gasLimit, '120000'); assert.equal(p.estimatedGasWei, '15000000');
  h.state.gas = BN.from(50000); h.state.gasPrice = BN.from(150); let submitting = false;
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet, undefined, () => { submitting = true; }), error => error.submissionState === 'not-submitted' && /Gas estimate increased/.test(error.message));
  assert.equal(submitting, false); assert.equal(h.state.sends.length, 0);
});
test('balance must cover retained request gas limit despite a lower fresh estimate', async () => {
  const h = harness(); const p = await h.core.prepareLaunch(h.draft, h.wallet);
  h.state.gas = BN.from(50000); h.state.balance = BN.from(p.totalValueWei).add('10000000');
  await assert.rejects(h.core.executePreparedLaunch(p, h.wallet), error => error.submissionState === 'not-submitted' && /full reviewed gas limit/.test(error.message));
  assert.equal(h.state.sends.length, 0);
});

test('Next production browser ES5 transform preserves ethers config Result as one argument', async () => {
  const h = harness({ held: false }, true);
  const state = await h.core.getProtocolState();
  assert.equal(state.configs[0].supplyWei, utils.parseEther('1000000000').toString());
  assert.equal(state.configs[0].graduationThresholdWei, utils.parseEther('4.2').toString());
  const p = await h.core.prepareLaunch(h.draft, h.wallet);
  assert.equal(p.totalValueWei, h.state.fee.toString());
});
