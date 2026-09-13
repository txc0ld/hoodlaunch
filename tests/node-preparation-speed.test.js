const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const ts = require('typescript');
const ethers = require('ethers');
const TOKEN = ethers.utils.getAddress('0x' + '11'.repeat(20));
const CURVE = ethers.utils.getAddress('0x' + '22'.repeat(20));
const nodes = Array.from({ length: 50 }, (_, i) => ethers.utils.getAddress('0x' + (i + 1).toString(16).padStart(40, '0')));
const runtimes = require('./fixtures/pons-trade-runtime.json').contracts;

function load(name, requireFixture, context = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + js + '\n})', { Date, Error, setTimeout, clearTimeout, ...context })(requireFixture, module, module.exports);
  return module.exports;
}

test('public preparation avoids HD derivation while signing still derives and checks the selected sender', async () => {
  // Public disposable fixture only. Never connected to a network.
  const root = ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk');
  let derivations = 0, signs = 0, prepares = 0, now = Date.now(), wrongDerivedAddress = false;
  let duringImport = () => {};
  class Clock extends Date { static now() { return now; } }
  class FixtureWallet extends ethers.Wallet {
    static createRandom() { return root; }
    async signTransaction(tx) { signs++; return super.signTransaction(tx); }
  }
  const fixtureEthers = { ...ethers, Wallet: FixtureWallet, utils: { ...ethers.utils, HDNode: {
    fromMnemonic(...args) {
      derivations++;
      const tree = ethers.utils.HDNode.fromMnemonic(...args);
      return wrongDerivedAddress ? { derivePath: () => tree.derivePath("m/44'/60'/0'/0/2") } : tree;
    },
  } } };
  const helpers = load('pons-trade', require);
  const trading = {
    async prepareTrade(session, nodeIndex, nodeAddress, token, side, amount, guard) {
      guard(); prepares++; return { nodeIndex, nodeAddress, token, side, amount };
    },
    async executeTrade(session, review, guard, sign) {
      guard(); return sign({ chainId: 4663, nonce: 0, to: TOKEN, value: 0, gasLimit: 21000, gasPrice: 1 });
    },
  };
  const v = load('node-vault', id => {
    if (id === 'ethers') return fixtureEthers;
    if (id === './pons-trade') return helpers;
    if (id === './node-trading') { duringImport(); return trading; }
    throw Error('Unexpected import');
  }, { Date: Clock });
  const original = v.createNodeSession(3);
  const backup = await v.encryptNodeBackup(original, 'disposable speed test password');
  const session = await v.restoreNodeBackup(backup, 'disposable speed test password');
  derivations = 0;
  for (const side of ['buy', 'sell']) {
    const review = await v.prepareNodeTrade(session, 1, TOKEN, side, 5);
    assert.equal(review.nodeAddress, session.addresses[1]);
  }
  console.log('PUBLIC_PREPARATION_HD_DERIVATIONS ' + derivations);
  assert.equal(derivations, 0, 'public preparation must not derive private wallet material');
  const review = await v.prepareNodeTrade(session, 1, TOKEN, 'buy', 5);
  const signed = await v.executeNodeTrade(session, review);
  assert.equal(ethers.utils.parseTransaction(signed).from, session.addresses[1]);
  assert.equal(derivations, 1); assert.equal(signs, 1);
  wrongDerivedAddress = true;
  await assert.rejects(v.executeNodeTrade(session, review), /Node address mismatch/);
  assert.equal(signs, 1);
  wrongDerivedAddress = false;
  await assert.rejects(v.executeNodeTrade(session, { ...review, nodeAddress: session.addresses[0] }), /another node/);
  const beforeInvalid = prepares;
  for (const invalid of [{ ...session }, { ...session, addresses: [TOKEN] }, original]) {
    await assert.rejects(v.prepareNodeTrade(invalid, 0, TOKEN, 'buy', 5));
  }
  for (const index of [-1, 3, 0.5, NaN, '1']) await assert.rejects(v.prepareNodeTrade(session, index, TOKEN, 'buy', 5));
  assert.equal(prepares, beforeInvalid);
  duringImport = () => { now += v.NODE_IDLE_MS; };
  await assert.rejects(v.prepareNodeTrade(session, 1, TOKEN, 'buy', 5), /no longer available/);
  assert.equal(prepares, beforeInvalid);
  await assert.rejects(v.prepareNodeTrade(session, 1, TOKEN, 'buy', 5), /no longer available/);
  assert.equal(signs, 1);
  v.forgetNodeSession(original); v.forgetNodeSession(session);
});

async function balanceRpc(t, options = {}) {
  const requests = []; let chainReads = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const input = JSON.parse(body); requests.push(input);
      let result;
      if (input.method === 'eth_chainId') result = (++chainReads === options.wrongAt) ? '0x1' : '0x1237';
      else if (input.method === 'eth_blockNumber') result = '0x64';
      else if (input.method === 'eth_getBalance') result = '0x20000000000001';
      else throw Error('Unexpected RPC method');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = 'http://127.0.0.1:' + server.address().port;
  class Dynamic extends ethers.providers.JsonRpcProvider { constructor() { super({ url, timeout: 15000 }); } }
  class Static extends ethers.providers.StaticJsonRpcProvider {
    constructor(connection, network) {
      assert.equal(connection.url, 'https://rpc.mainnet.chain.robinhood.com');
      assert.equal(connection.timeout, 15000); assert.equal(network.chainId, 4663);
      super({ url, timeout: 15000 }, network);
    }
  }
  const v = load('node-balances', id => id === 'ethers'
    ? { ...ethers, providers: { ...ethers.providers, JsonRpcProvider: Dynamic, StaticJsonRpcProvider: Static } }
    : { PONS_CHAIN_ID: 4663, PONS_RPC: 'https://rpc.mainnet.chain.robinhood.com' });
  return { ...v, requests };
}

test('actual balance provider uses exactly two direct chain guards and no repeated detection', async t => {
  const h = await balanceRpc(t);
  const result = await h.getNodeBalances(nodes.slice(0, 6));
  const chains = h.requests.filter(r => r.method === 'eth_chainId').length;
  console.log('BALANCE_RPC ' + JSON.stringify({ requests: h.requests.length, chainReads: chains }));
  assert.equal(chains, 2); assert.equal(h.requests.length, 9);
  assert.deepEqual(Array.from(result.balances, row => row.address), nodes.slice(0, 6));
  assert.ok(result.balances.every(row => row.balanceWei === '9007199254740993'));
  assert.ok(h.requests.filter(r => r.method === 'eth_getBalance').every(r => r.params[1] === '0x64'));
});

test('actual balance provider rejects both initial and final wrong-chain responses', async t => {
  for (const wrongAt of [1, 2]) await t.test('guard ' + wrongAt, async t => {
    const h = await balanceRpc(t, { wrongAt });
    await assert.rejects(h.getNodeBalances(nodes.slice(0, 6)), /Could not read node balances/);
    if (wrongAt === 1) assert.equal(h.requests.filter(r => r.method === 'eth_getBalance').length, 0);
  });
});

function snapshotFixture(options = {}) {
  let queue = [], chains = 0, maximum = 0, active = 0;
  const calls = [], waves = [];
  function read(name, result, block) {
    assert.equal(block, 100, name + ' must use the pinned block');
    calls.push(name);
    return new Promise((resolve, reject) => queue.push(() => options.fail === name ? reject(Error('fixture read failure')) : resolve(result)));
  }
  class Provider {
    async send(method) { assert.equal(method, 'eth_chainId'); return ++chains === options.wrongAt ? '0x1' : '0x1237'; }
    async getBlockNumber() { return 100; }
    getCode(address, block) { return read('code:' + address.toLowerCase(), options.badCode ? '0x00' : runtimes[address.toLowerCase()] || '0x1234', block); }
    async getBalance(node, block) {
      active++; maximum = Math.max(maximum, active);
      try { return await read('eth:' + node, ethers.BigNumber.from('9007199254740993'), block); } finally { active--; }
    }
    removeAllListeners() { calls.push('cleanup'); }
  }
  class Contract {
    getLaunchedToken(token, b) { return read('launch', { token: options.badLaunch ? CURVE : token, curve: CURVE, pairToken: ethers.constants.AddressZero, exists: true, phase: 0, poolFee: 0, tickSpacing: 200 }, b.blockTag); }
    token(b) { return read('curveToken', TOKEN, b.blockTag); }
    pairToken(b) { return read('pair', ethers.constants.AddressZero, b.blockTag); }
    isNativeQuote(b) { return read('native', true, b.blockTag); }
    readyToGraduate(b) { return read('ready', false, b.blockTag); }
    graduated(b) { return read('graduated', false, b.blockTag); }
    symbol(b) { return read('symbol', 'TST', b.blockTag); }
    decimals(b) { return read('decimals', options.badMetadata ? 37 : 18, b.blockTag); }
    totalSupply(b) { return read('supply', ethers.utils.parseEther('1000000'), b.blockTag); }
    balanceOf(node, b) { return read('holding:' + node, ethers.utils.parseEther('100'), b.blockTag); }
  }
  const p = load('pons-trade', id => id === 'ethers' ? { ...ethers, Contract, providers: { StaticJsonRpcProvider: Provider } } : require(id));
  async function snapshot(count = 6) {
    let settled = false, result, failure;
    p.getNodeTradingSnapshot(TOKEN, nodes.slice(0, count)).then(value => { result = value; settled = true; }, error => { failure = error; settled = true; });
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setImmediate(resolve));
      if (!queue.length && settled) break;
      assert.ok(queue.length, 'snapshot stalled');
      waves.push(calls.slice(waves.reduce((sum, wave) => sum + wave.length, 0)));
      const pending = queue; queue = []; pending.forEach(resolve => resolve());
    }
    assert.equal(settled, true);
    if (failure) throw failure;
    return result;
  }
  return { snapshot, calls, waves, get maximum() { return maximum; }, get chains() { return chains; } };
}

test('snapshot overlaps independent pinned reads and retains four-node balance waves', async () => {
  const h = snapshotFixture(); const result = await h.snapshot();
  console.log('SNAPSHOT_READ_WAVES ' + JSON.stringify(h.waves.map(wave => wave.length)));
  assert.equal(h.waves.length, 4, 'two validation waves followed by two four-node balance waves');
  assert.ok(h.waves[0].includes('launch')); assert.ok(h.waves[0].includes('symbol'));
  assert.equal(h.maximum, 4); assert.equal(h.chains, 2);
  assert.deepEqual(Array.from(result.balances, row => row.nodeAddress), nodes.slice(0, 6));
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.balances));
});

test('snapshot failures never publish holdings and validation failures never start balances', async () => {
  for (const options of [{ wrongAt: 1 }, { wrongAt: 2 }, { badCode: true }, { badLaunch: true }, { badMetadata: true }, { fail: 'symbol' }, { fail: 'launch' }, { fail: 'curveToken' }, { fail: 'eth:' + nodes[0] }]) {
    const h = snapshotFixture(options);
    await assert.rejects(h.snapshot());
    assert.equal(h.calls.at(-1), 'cleanup');
    if (!options.fail?.startsWith('eth:') && options.wrongAt !== 2) assert.equal(h.calls.some(call => call.startsWith('eth:')), false);
  }
});

test('snapshot retains ordered fifty-node output and four-node read limit', async () => {
  const h = snapshotFixture(); const result = await h.snapshot(50);
  assert.equal(h.maximum, 4); assert.equal(h.chains, 2);
  assert.deepEqual(Array.from(result.balances, row => row.nodeAddress), nodes);
});
