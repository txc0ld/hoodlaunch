const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const ts = require('typescript');
const ethers = require('ethers');

const eth = ethers.utils.parseEther;
const wallet = ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk');
const TOKEN = ethers.utils.getAddress(`0x${'11'.repeat(20)}`);
const CURVE = ethers.utils.getAddress(`0x${'22'.repeat(20)}`);
const runtimes = require('./fixtures/pons-trade-runtime.json').contracts;
const protocolModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/pons-trade.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(require, protocolModule, protocolModule.exports);
const protocol = protocolModule.exports;
const permitInterface = new ethers.utils.Interface(protocol.TRADE_PERMIT_ABI);
const universalInterface = new ethers.utils.Interface(protocol.TRADE_UNIVERSAL_ABI);
const quoterInterface = new ethers.utils.Interface(protocol.TRADE_QUOTER_ABI);
function v4Swap(tx) {
  const decoded = universalInterface.decodeFunctionData('execute', tx.data);
  const [, params] = ethers.utils.defaultAbiCoder.decode(['bytes', 'bytes[]'], decoded.inputs[0]);
  return ethers.utils.defaultAbiCoder.decode([`(${protocol.POOL_KEY},bool,uint128,uint128,uint256,bytes)`], params[0])[0];
}


const factoryInterface = new ethers.utils.Interface([
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
]);
const curveInterface = new ethers.utils.Interface([
  'function token() view returns (address)',
  'function pairToken() view returns (address)',
  'function isNativeQuote() view returns (bool)',
  'function readyToGraduate() view returns (bool)',
  'function graduated() view returns (bool)',
  'function getReserves() view returns (uint256 quoteReserve,uint256 tokenReserve)',
  'function sellableTokens() view returns (uint256)',
  'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)',
  'function currentSnipeTaxBps(address) view returns (uint256)',
]);
const tokenInterface = new ethers.utils.Interface([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);

function encodeResult(contractInterface, name, values) {
  return contractInterface.encodeFunctionResult(name, values);
}

function callResult(transaction, state) {
  const selector = transaction.data.slice(0, 10);
  if (selector === ethers.utils.id('memeHook()').slice(0, 10)) return ethers.utils.defaultAbiCoder.encode(['address'], [protocol.TRADE_HOOK]);
  if (transaction.to.toLowerCase() === protocol.TRADE_PERMIT2.toLowerCase()) {
    if (selector === permitInterface.getSighash('allowance')) return permitInterface.encodeFunctionResult('allowance', [state.permit, state.permitExpiration || 0, 0]);
    return '0x';
  }
  if (selector === quoterInterface.getSighash('quoteExactInputSingle')) {
    const [params] = quoterInterface.decodeFunctionData('quoteExactInputSingle', transaction.data);
    return quoterInterface.encodeFunctionResult('quoteExactInputSingle', [params[1] ? params[2].mul(100) : params[2].div(100), 200000]);
  }
  if (selector === factoryInterface.getSighash('getLaunchedToken')) {
    return encodeResult(factoryInterface, 'getLaunchedToken', [[
      TOKEN, state.curve || CURVE, wallet.address, wallet.address, ethers.constants.AddressZero,
      eth('100'), 0, 200, 0, false, state.phase, 0, 0, 0, true,
    ]]);
  }
  const curveResults = new Map([
    [curveInterface.getSighash('token'), ['token', [TOKEN]]],
    [curveInterface.getSighash('pairToken'), ['pairToken', [ethers.constants.AddressZero]]],
    [curveInterface.getSighash('isNativeQuote'), ['isNativeQuote', [true]]],
    [curveInterface.getSighash('readyToGraduate'), ['readyToGraduate', [false]]],
    [curveInterface.getSighash('graduated'), ['graduated', [state.phase === 2]]],
    [curveInterface.getSighash('getReserves'), ['getReserves', [state.quoteReserve, state.tokenReserve]]],
    [curveInterface.getSighash('sellableTokens'), ['sellableTokens', [eth('900000')]]],
    [curveInterface.getSighash('feeBps'), ['feeBps', [100]]],
    [curveInterface.getSighash('creatorTaxBps'), ['creatorTaxBps', [0]]],
    [curveInterface.getSighash('currentSnipeTaxBps'), ['currentSnipeTaxBps', [0]]],
  ]);
  const curve = curveResults.get(selector);
  if (curve) return encodeResult(curveInterface, curve[0], curve[1]);
  const tokenResults = new Map([
    [tokenInterface.getSighash('balanceOf'), ['balanceOf', [state.holding]]],
    [tokenInterface.getSighash('symbol'), ['symbol', ['TST']]],
    [tokenInterface.getSighash('decimals'), ['decimals', [18]]],
  ]);
  tokenResults.set(tokenInterface.getSighash('allowance'), ['allowance', [state.allowance]]);
  tokenResults.set(tokenInterface.getSighash('approve'), ['approve', [true]]);
  const token = tokenResults.get(selector);
  if (token) return encodeResult(tokenInterface, token[0], token[1]);
  return '0x';
}

async function loopbackRpc({ delayMs = 5, chainId = '0x1237', phase = 0, sellGas = 200000 } = {}) {
  const requests = [];
  let currentChainId = chainId;
  let chainIdResponses = [];
  let pendingNonce = 0;
  let latestNonce = 0;
  const accountNonces = new Map();
  const state = { feeBase: '0x3b9aca00', actualFee: null, phase, permit: eth('0'), balance: eth('0.003'), holding: eth('0'), allowance: eth('0'), quoteReserve: eth('100'), tokenReserve: eth('1000000'), transactions: new Map(), receipts: new Map(), mined: 100 };
  const tradeInterface = new ethers.utils.Interface([
    'function buy(uint256,uint256,address)', 'function sell(uint256,uint256,address)',
    'event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax)',
    'event CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 tax)'
  ]);
  const gasFor = tx => tx.data.startsWith(tokenInterface.getSighash('approve')) || tx.data.startsWith(permitInterface.getSighash('approve')) ? (state.approvalGas || 50000) : tx.data.startsWith(tradeInterface.getSighash('sell')) || (tx.data.startsWith(universalInterface.getSighash('execute')) && !v4Swap(tx)[1]) ? sellGas : 100000;
  let rejectedMethod = '';
  let onRequest = () => {};
  const block = {
    hash: `0x${'aa'.repeat(32)}`,
    parentHash: `0x${'bb'.repeat(32)}`,
    number: '0x64',
    timestamp: '0x6b49d200',
    nonce: '0x0000000000000000',
    difficulty: '0x0',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    miner: ethers.constants.AddressZero,
    extraData: '0x',
    transactions: [],
    baseFeePerGas: '0x3b9aca00',
  };

  function resultFor(method, params) {
    if (method === rejectedMethod) throw new Error('fixture provider rejection');
    if (method === 'eth_chainId') return chainIdResponses.length ? chainIdResponses.shift() : currentChainId;
    if (method === 'eth_blockNumber') return ethers.utils.hexValue(state.mined + 2);
    if (method === 'eth_getBalance') return (params[1] === 'pending' && state.pendingBalance !== undefined ? state.pendingBalance : state.balance).toHexString();
    if (method === 'eth_getTransactionCount') return ethers.utils.hexValue(params[1] === 'pending' ? (accountNonces.get(params[0].toLowerCase()) || 0) : latestNonce);
    if (method === 'eth_getCode') return runtimes[params[0].toLowerCase()] || '0x1234';
    if (method === 'eth_getBlockByNumber') return { ...block, baseFeePerGas: state.feeBase };
    if (method === 'eth_gasPrice') return '0x77359400';
    if (method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
    if (method === 'eth_estimateGas') {
      const tx = params[0];
      if (tx.maxFeePerGas && ethers.BigNumber.from(tx.value || 0).add(ethers.BigNumber.from(gasFor(tx)).mul(tx.maxFeePerGas)).gt(state.balance)) throw Error('insufficient funds for gas');
      return ethers.utils.hexValue(gasFor(tx));
    }
    if (method === 'eth_call') return callResult(params[0], state);
    if (method === 'eth_sendRawTransaction') {
      const tx = ethers.utils.parseTransaction(params[0]);
      assert.equal(tx.nonce, accountNonces.get(tx.from.toLowerCase()) || 0);
      assert.ok(tx.value.add(tx.gasLimit.mul(tx.maxFeePerGas)).lte(state.balance));
      state.transactions.set(tx.hash, tx); pendingNonce++; accountNonces.set(tx.from.toLowerCase(), tx.nonce + 1);
      return tx.hash;
    }
    if (method === 'eth_getTransactionReceipt') return state.receipts.get(params[0]) || null;
    if (method === 'eth_getTransactionByHash') {
      const tx = state.transactions.get(params[0]); if (!tx) return null;
      return { ...tx, input: tx.data, gas: tx.gasLimit.toHexString(), nonce: ethers.utils.hexValue(tx.nonce), chainId: '0x1237', type: '0x2', value: tx.value.toHexString(), maxFeePerGas: tx.maxFeePerGas.toHexString(), maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toHexString(), blockHash: block.hash, blockNumber: ethers.utils.hexValue(state.mined), transactionIndex: '0x0' };
    }
    throw new Error(`unsupported fixture RPC method ${method}`);
  }

  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const input = JSON.parse(body);
      const batch = Array.isArray(input) ? input : [input];
      const output = batch.map(entry => {
        requests.push({ method: entry.method, params: entry.params });
        onRequest(entry, requests);
        try {
          return { jsonrpc: '2.0', id: entry.id, result: resultFor(entry.method, entry.params) };
        } catch (error) {
          return { jsonrpc: '2.0', id: entry.id, error: { code: -32601, message: error.message } };
        }
      });
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(Array.isArray(input) ? output : output[0]));
      }, delayMs);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    requests, state,
    mine: hash => {
      const tx = state.transactions.get(hash); assert.ok(tx);
      const gasUsed = ethers.BigNumber.from(gasFor(tx));
      // At the quoted EIP-1559 maximum, actual gas use is still below padded gas.
      const actualFee = state.actualFee || tx.maxFeePerGas;
      assert.ok(actualFee.lte(tx.maxFeePerGas));
      state.balance = state.balance.sub(tx.value).sub(gasUsed.mul(actualFee));
      state.mined++; latestNonce = pendingNonce;
      let event, contract;
      if (tx.data.startsWith(tokenInterface.getSighash('approve'))) {
        const [spender, amount] = tokenInterface.decodeFunctionData('approve', tx.data);
        state.allowance = amount; contract = TOKEN;
        event = tokenInterface.encodeEventLog(tokenInterface.getEvent('Approval'), [wallet.address, spender, amount]);
      } else if (tx.data.startsWith(permitInterface.getSighash('approve'))) {
        const [token, spender, amount, expiration] = permitInterface.decodeFunctionData('approve', tx.data);
        state.permit = amount; state.permitExpiration = expiration; contract = protocol.TRADE_PERMIT2;
        event = permitInterface.encodeEventLog(permitInterface.getEvent('Approval'), [wallet.address, token, spender, amount, expiration]);
      } else if (tx.data.startsWith(universalInterface.getSighash('execute'))) {
        const swap = v4Swap(tx); const input = swap[2]; contract = TOKEN;
        if (swap[1]) {
          const output = input.mul(100); state.holding = state.holding.add(output);
          event = tokenInterface.encodeEventLog(tokenInterface.getEvent('Transfer'), [protocol.TRADE_POOL_MANAGER, wallet.address, output]);
        } else {
          assert.ok(state.allowance.gte(input)); assert.ok(state.permit.gte(input)); assert.ok(state.holding.gte(input));
          state.holding = state.holding.sub(input); state.allowance = state.allowance.sub(input); state.permit = state.permit.sub(input); state.balance = state.balance.add(input.div(100));
          event = tokenInterface.encodeEventLog(tokenInterface.getEvent('Transfer'), [wallet.address, protocol.TRADE_POOL_MANAGER, input]);
        }
      } else {
        const parsed = tradeInterface.parseTransaction(tx); const input = parsed.args[0]; contract = CURVE;
        if (parsed.name === 'buy') {
          const effective = input.mul(99).div(100);
          const output = effective.mul(state.tokenReserve).div(state.quoteReserve.add(effective));
          state.holding = state.holding.add(output); state.tokenReserve = state.tokenReserve.sub(output); state.quoteReserve = state.quoteReserve.add(effective);
          event = tradeInterface.encodeEventLog(tradeInterface.getEvent('CurveBuy'), [wallet.address, wallet.address, input, output, input.sub(effective), 0]);
        } else {
          assert.ok(state.allowance.gte(input)); assert.ok(state.holding.gte(input));
          const gross = input.mul(state.quoteReserve).div(state.tokenReserve.add(input)); const output = gross.mul(99).div(100);
          state.holding = state.holding.sub(input); state.allowance = state.allowance.sub(input); state.balance = state.balance.add(output); state.quoteReserve = state.quoteReserve.sub(gross); state.tokenReserve = state.tokenReserve.add(input);
          event = tradeInterface.encodeEventLog(tradeInterface.getEvent('CurveSell'), [wallet.address, wallet.address, input, output, gross.sub(output), 0]);
        }
      }
      const receipt = { to: tx.to, from: tx.from, transactionHash: hash, transactionIndex: '0x0', blockHash: block.hash, blockNumber: ethers.utils.hexValue(state.mined), cumulativeGasUsed: gasUsed.toHexString(), gasUsed: gasUsed.toHexString(), effectiveGasPrice: actualFee.toHexString(), status: '0x1', type: '0x2', logsBloom: '0x'+'00'.repeat(256), logs: [{ ...event, address: contract, blockHash: block.hash, blockNumber: ethers.utils.hexValue(state.mined), transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false }] };
      state.receipts.set(hash, receipt);
    },
    url: `http://127.0.0.1:${address.port}`,
    setChainId: value => { currentChainId = value; },
    setChainIdResponses: values => { chainIdResponses = [...values]; },
    setNonces: (pending, latest) => { pendingNonce = pending; latestNonce = latest; accountNonces.set(wallet.address.toLowerCase(), pending); },
    setCurveTokenReserve: value => { state.tokenReserve = value; },
    rejectMethod: method => { rejectedMethod = method; },
    setOnRequest: callback => { onRequest = callback; },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      if (server.closeAllConnections) server.closeAllConnections();
    }),
  };
}

function actualProviderTrading(url, options = {}) {
  const modules = {};
  const storage = new Map();
  const heldLocks = new Set();

  class LoopbackJsonRpcProvider extends ethers.providers.JsonRpcProvider {
    constructor() { super({ url, timeout: 15000 }); }
  }
  class LoopbackStaticJsonRpcProvider extends ethers.providers.StaticJsonRpcProvider {
    constructor(connection, network) {
      assert.equal(connection.url, 'https://rpc.mainnet.chain.robinhood.com');
      assert.equal(connection.timeout, 15000);
      assert.equal(network.chainId, 4663);
      assert.equal(network.name, 'robinhood');
      super({ url, timeout: 15000 }, { chainId: 4663, name: 'robinhood-fixture' });
    }
  }
  const fixtureEthers = {
    ...ethers,
    providers: {
      ...ethers.providers,
      JsonRpcProvider: LoopbackJsonRpcProvider,
      StaticJsonRpcProvider: LoopbackStaticJsonRpcProvider,
    },
  };
  const context = {
    Date: options.clock || Date,
    Error,
    console,
    setTimeout,
    clearTimeout,
    window: {
      localStorage: {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => {
          if (options.storageFail) throw new Error('fixture storage failure');
          storage.set(key, value);
        },
      },
    },
    navigator: { locks: { request: async (name, _options, callback) => { if (heldLocks.has(name)) return callback(null); heldLocks.add(name); try { return await callback({ name }); } finally { heldLocks.delete(name); } } } },
  };

  function load(name) {
    if (modules[name]) return modules[name];
    const module = { exports: {} };
    modules[name] = module.exports;
    const source = fs.readFileSync(path.join(__dirname, `../src/lib/${name}.ts`), 'utf8');
    const javascript = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${javascript}\n})`, context)(
      id => id === 'ethers' ? fixtureEthers : id.startsWith('./') ? load(id.slice(2)) : require(id),
      module,
      module.exports,
    );
    return module.exports;
  }

  const trading = load('node-trading');
  const wallets = options.wallets || [wallet];
  const session = Object.freeze({ id: 'inert-roundtrip', backupVerified: true, addresses: Object.freeze(wallets.map(w => w.address)) });
  modules['node-vault'] = { MAX_NODES: 50, getNodeFinancialEpoch: () => 1, assertNodeFinancialEpoch: () => {}, isVerifiedNodeSession: value => value === session,
    prepareNodeTrade: (s, index, token, side, percent) => { assert.equal(s, session); return trading.prepareTrade(session, index, wallets[index].address, token, side, percent, () => {}); },
    executeNodeTrade: (s, review, guard) => { assert.equal(s, session); return trading.executeTrade(session, review, guard, tx => wallets[review.nodeIndex].signTransaction(tx)); }
  };
  return { trading, batch: load('node-trade-batch'), session, storage };
}


async function bought(t, { preapproved = false, sellGas = 200000, phase = 0, actualFee = null } = {}) {
  const rpc = await loopbackRpc({ delayMs: 0, sellGas, phase });
  rpc.state.actualFee = actualFee; t.after(() => rpc.close());
  const h = actualProviderTrading(rpc.url); const guard = () => {};
  if (preapproved) rpc.state.allowance = ethers.constants.MaxUint256;
  const review = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'buy', guard);
  assert.equal(review.entries[0].status, 'ready');
  const results = await h.batch.executeNodeTradeBatch(h.session, review, guard);
  assert.equal(results[0].status, 'submitted');
  rpc.mine(results[0].operation.txHash);
  return { ...h, rpc, guard, buy: review.entries[0].review };
}

test('mined Max Buy remains blocked until recovery status is explicitly refreshed', async t => {
  const h = await bought(t);
  const blocked = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', h.guard);
  assert.equal(blocked.entries[0].status, 'blocked');
  assert.match(blocked.entries[0].error, /unresolved Robinhood transaction/);
  assert.equal(h.trading.getNodeTradeOperation(wallet.address).status, 'pending');
  assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  console.log('ROUNDTRIP_PENDING ' + JSON.stringify({ error: blocked.entries[0].error, sends: h.rpc.state.transactions.size, persistedRecords: h.storage.size }));
});

test('Max Buy then confirmed approval then Max Sell retains enough ETH without wallet refill', async t => {
  const h = await bought(t);
  assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  const snapshot = { buyValue: h.buy.amountInRaw, buyGas: h.buy.maxGasCostWei, fee: h.buy.maxFeePerGasWei, remainingEth: h.rpc.state.balance.toString() };
  for (const expectedAction of ['approve-token', 'sell']) {
    const review = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', h.guard);
    console.log('ROUNDTRIP_STEP ' + JSON.stringify({ ...snapshot, expectedAction, status: review.entries[0].status, error: review.entries[0].error, requests: h.rpc.requests.length }));
    assert.equal(review.entries[0].status, 'ready', review.entries[0].error);
    assert.equal(review.entries[0].review.action, expectedAction);
    const results = await h.batch.executeNodeTradeBatch(h.session, review, h.guard);
    assert.equal(results[0].status, 'submitted');
    h.rpc.mine(results[0].operation.txHash);
    assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  }
  assert.ok(h.rpc.state.holding.isZero());
  assert.equal(h.rpc.state.transactions.size, 3);
  assert.equal(h.storage.size, 1);
});


test('diagnostic: funding only the retained ETH clears approval and sale in the same wallet', async t => {
  const h = await bought(t);
  assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  h.rpc.state.balance = h.rpc.state.balance.add(eth('0.001'));
  for (const action of ['approve-token', 'sell']) {
    const review = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', h.guard);
    assert.equal(review.entries[0].status, 'ready', review.entries[0].error);
    assert.equal(review.entries[0].review.action, action);
    const results = await h.batch.executeNodeTradeBatch(h.session, review, h.guard);
    assert.equal(results[0].status, 'submitted'); h.rpc.mine(results[0].operation.txHash);
    assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  }
  assert.ok(h.rpc.state.holding.isZero()); assert.equal(h.rpc.state.transactions.size, 3);
});

test('preexisting allowance allows a fresh Max Sell after Max Buy without funding', async t => {
  const h = await bought(t, { preapproved: true });
  assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', h.guard);
  assert.equal(batch.entries[0].status, 'ready', batch.entries[0].error);
  assert.equal(batch.entries[0].review.action, 'sell');
  assert.equal(h.rpc.state.transactions.size, 1);
});


test('fifty actual-module nodes retain an executable batch under delayed RPC', { skip: !process.env.ROUNDTRIP_50_NODE }, async t => {
  const rpc = await loopbackRpc({ delayMs: 200 }); t.after(() => rpc.close());
  const wallets = Array.from({ length: 50 }, (_, i) => new ethers.Wallet(ethers.utils.hexZeroPad(ethers.utils.hexlify(i + 1), 32)));
  const h = actualProviderTrading(rpc.url, { wallets }); const started = performance.now();
  const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'buy', () => {});
  const preparedMs = Math.round(performance.now() - started);
  const results = await h.batch.executeNodeTradeBatch(h.session, batch, () => {});
  const submitted = results.filter(result => result.status === 'submitted').length;
  const totalMs = Math.round(performance.now() - started);
  console.log('ROUNDTRIP_50_NODE ' + JSON.stringify({ delayMs: 200, preparedMs, totalMs, submitted, prepared: batch.entries.filter(e => e.status === 'ready').length, requests: rpc.requests.length, firstFailure: results.find(r => r.status !== 'submitted') }));
  assert.equal(submitted, 50, 'All fifty immediately submitted Max Buy actions should complete the batch within their guarded validity');
});


for (const phase of [0, 2]) test(`proposed reserve envelope survives asymmetric gas and explicit approvals in phase ${phase}`, async t => {
  const rpc = await loopbackRpc({ delayMs: 0, phase, sellGas: 200000 }); t.after(() => rpc.close());
  const h = actualProviderTrading(rpc.url); const guard = () => {};
  // Model the proposed Max amount using today's exact custom-buy path before changing production.
  const maxFee = ethers.utils.parseUnits('3.5', 'gwei');
  const retained = ethers.BigNumber.from(130000).mul(maxFee).mul(phase === 0 ? 4 : 5).add(eth('0.00005'));
  const buy = await h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'buy', { amount: ethers.utils.formatEther(rpc.state.balance.sub(retained)) }, guard);
  const operation = await h.trading.executeTrade(h.session, buy, guard, tx => wallet.signTransaction(tx));
  rpc.mine(operation.txHash); assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  for (const action of phase === 0 ? ['approve-token', 'sell'] : ['approve-token', 'approve-router', 'sell']) {
    const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', guard);
    assert.equal(batch.entries[0].status, 'ready', batch.entries[0].error);
    assert.equal(batch.entries[0].review.action, action);
    const results = await h.batch.executeNodeTradeBatch(h.session, batch, guard);
    assert.equal(results[0].status, 'submitted'); rpc.mine(results[0].operation.txHash);
    assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  }
  assert.ok(rpc.state.holding.isZero()); assert.equal(rpc.state.transactions.size, phase === 0 ? 3 : 4);
});


test('retiring a review excludes exposed old capabilities and concurrent signing', async t => {
  const rpc = await loopbackRpc({ delayMs: 0 }); t.after(() => rpc.close());
  const h = actualProviderTrading(rpc.url); const guard = () => {};
  const original = await h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'buy', 100, guard);
  await assert.rejects(h.trading.retireNodeTradeReview({}, original, guard), /invalid|used/);
  await h.trading.retireNodeTradeReview(h.session, original, guard);
  await assert.rejects(h.trading.executeTrade(h.session, original, guard, tx => wallet.signTransaction(tx)), /invalid|used/);
  await assert.rejects(h.trading.retireNodeTradeReview(h.session, original, guard), /invalid|used/);
  assert.equal(rpc.state.transactions.size, 0);
  const fresh = await h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'buy', 100, guard);
  let releaseSigner, signerReached;
  const reached = new Promise(resolve => { signerReached = resolve; });
  const held = new Promise(resolve => { releaseSigner = resolve; });
  const execution = h.trading.executeTrade(h.session, fresh, guard, async tx => { signerReached(); await held; return wallet.signTransaction(tx); });
  await reached;
  await assert.rejects(h.trading.retireNodeTradeReview(h.session, fresh, guard), /Another tab/);
  releaseSigner(); const operation = await execution; assert.equal(operation.status, 'pending');
  rpc.mine(operation.txHash); assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  await assert.rejects(h.trading.retireNodeTradeReview(h.session, fresh, guard), /invalid|used/);
  assert.equal(rpc.state.transactions.size, 1);
});


for (const phase of [0, 2]) for (const fee of ['2.5', '3.5']) test(`Max roundtrip phase ${phase}, actual fee ${fee} below or equal to cap`, async t => {
  const h = await bought(t, { phase, actualFee: ethers.utils.parseUnits(fee, 'gwei') });
  assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  for (const action of phase === 0 ? ['approve-token', 'sell'] : ['approve-token', 'approve-router', 'sell']) {
    const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', h.guard);
    assert.equal(batch.entries[0].status, 'ready', batch.entries[0].error); assert.equal(batch.entries[0].review.action, action);
    const results = await h.batch.executeNodeTradeBatch(h.session, batch, h.guard);
    assert.equal(results[0].status, 'submitted'); h.rpc.mine(results[0].operation.txHash);
    assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  }
  assert.ok(h.rpc.state.holding.isZero()); assert.equal(h.rpc.state.transactions.size, phase === 0 ? 3 : 4);
});
test('previously stranded wallets receive an actionable gas error and never submit', async t => {
  const h = await bought(t); assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  h.rpc.state.balance = eth('0.000155');
  const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', h.guard);
  assert.equal(batch.entries[0].status, 'blocked'); assert.match(batch.entries[0].error, /Robinhood ETH.*gas.*Fund the node.*refresh/);
  assert.equal(h.rpc.state.transactions.size, 1);
});
test('base plus full reviewed tip above a Max review cap fails before signing', async t => {
  const rpc = await loopbackRpc({ delayMs: 0 }); t.after(() => rpc.close()); const h = actualProviderTrading(rpc.url);
  const review = await h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'buy', 100, () => {});
  rpc.state.feeBase = ethers.utils.parseUnits('2', 'gwei').add(1).toHexString(); let signs = 0;
  await assert.rejects(h.trading.executeTrade(h.session, review, () => {}, async () => { signs++; throw Error('unexpected signer'); }), /base fee plus the reviewed priority fee exceeds/);
  assert.equal(signs, 0); assert.equal(rpc.state.transactions.size, 0);
});

async function feeReview(t, { phase = 0, action = 'approve-token' } = {}) {
  const rpc = await loopbackRpc({ delayMs: 0, phase }); t.after(() => rpc.close());
  rpc.state.feeBase = ethers.BigNumber.from('85020000').toHexString();
  rpc.state.approvalGas = 46391;
  rpc.state.balance = action === 'approve-token' ? eth('0.000271931252512') : eth('1');
  rpc.state.holding = eth('100');
  if (action === 'sell' || action === 'approve-router') rpc.state.allowance = eth('100');
  if (action === 'sell') { rpc.state.permit = eth('100'); rpc.state.permitExpiration = Math.floor(Date.now() / 1000) + 3600; }
  const h = actualProviderTrading(rpc.url);
  const review = await h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, action === 'buy' ? 'buy' : 'sell', action === 'buy' ? 5 : 100, () => {});
  assert.equal(review.action, action);
  assert.equal(review.maxFeePerGasWei, '1670040000');
  assert.equal(review.maxPriorityFeePerGasWei, '1500000000');
  if (action === 'approve-token') {
    assert.equal(review.gasLimit, '60309'); assert.equal(review.maxTotalEthWei, '100718442360000');
    assert.equal(review.balanceAfterMaxCostWei, '171212810152000');
    assert.equal(review.requiredRemainingEthWei, eth(phase === 0 ? '0.00005' : '0.0001').toString());
  }
  return { ...h, rpc, review };
}

async function sellAffordabilityFixture(t, { phase = 0, balance = '273277424450000', sellGas = 125774, baseFee = '85675000' } = {}) {
  const rpc = await loopbackRpc({ delayMs: 0, phase, sellGas }); t.after(() => rpc.close());
  rpc.state.feeBase = ethers.BigNumber.from(baseFee).toHexString();
  rpc.state.balance = ethers.BigNumber.from(balance);
  rpc.state.holding = eth('100'); rpc.state.allowance = eth('100');
  rpc.state.permit = eth('100'); rpc.state.permitExpiration = Math.floor(Date.now() / 1000) + 3600;
  const h = actualProviderTrading(rpc.url);
  return { ...h, rpc };
}

for (const phase of [0, 2]) for (const amount of [100, 50, { amount: '25' }]) test(`sell affordability: phase ${phase} amount ${JSON.stringify(amount)} final sale can spend its full reviewed upfront gas without a future-step floor`, async t => {
  const h = await sellAffordabilityFixture(t, { phase }); const { rpc } = h;
  const batch = amount === 100 ? await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', () => {}) : { entries: [{ status: 'ready', review: await h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'sell', amount, () => {}) }] };
  console.log('SELL_AFFORDABILITY ' + JSON.stringify({ phase, balance: rpc.state.balance.toString(), expectedUpfrontGas: '273277424450000', status: batch.entries[0].status, error: batch.entries[0].error }));
  assert.equal(batch.entries[0].status, 'ready', batch.entries[0].error);
  const review = batch.entries[0].review;
  assert.equal(review.gasLimit, '163507'); assert.equal(review.maxFeePerGasWei, '1671350000');
  assert.equal(review.requiredRemainingEthWei, '0'); assert.equal(review.gasReserveWei, review.maxGasCostWei);
  assert.equal(review.amountInRaw, eth(amount === 100 ? '100' : amount === 50 ? '50' : '25').toString());
  const operation = await h.trading.executeTrade(h.session, review, () => {}, tx => wallet.signTransaction(tx));
  assert.equal(operation.status, 'pending'); assert.equal(rpc.state.transactions.size, 1);
});

for (const balance of ['48750000000000', '50000000000000']) test(`sell affordability: funded final sale at balance ${balance} at or below the old floor`, async t => {
  const h = await sellAffordabilityFixture(t, { balance, sellGas: 25000, baseFee: '0' });
  const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', () => {});
  console.log('SELL_LOW_BALANCE ' + JSON.stringify({ balance, status: batch.entries[0].status, error: batch.entries[0].error }));
  assert.equal(batch.entries[0].status, 'ready', batch.entries[0].error);
  assert.equal(batch.entries[0].review.maxTotalEthWei, '48750000000000');
  const result = await h.batch.executeNodeTradeBatch(h.session, batch, () => {});
  assert.equal(result[0].status, 'submitted'); assert.equal(h.rpc.state.transactions.size, 1);
});

for (const delta of [0, -1]) test(`sell affordability: pending execution balance at upfront cost ${delta} wei`, async t => {
  const h = await sellAffordabilityFixture(t, { balance: eth('1').toString() });
  const review = await h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'sell', 100, () => {});
  h.rpc.state.pendingBalance = ethers.BigNumber.from(review.maxTotalEthWei).add(delta);
  let signs = 0; const sign = tx => { signs++; return wallet.signTransaction(tx); };
  const start = h.rpc.requests.length;
  if (delta === 0) {
    const operation = await h.trading.executeTrade(h.session, review, () => {}, sign);
    assert.equal(operation.status, 'pending'); assert.equal(signs, 1);
  } else {
    await assert.rejects(h.trading.executeTrade(h.session, review, () => {}, sign), /insufficient ETH/);
    assert.equal(signs, 0); assert.equal(h.rpc.state.transactions.size, 0);
  }
  assert.ok(h.rpc.requests.slice(start).some(r => r.method === 'eth_getBalance' && r.params[1] === 'pending'));
});

for (const balance of ['273277424449999', '171212810152000']) test(`sell diagnosis: upfront shortage at ${balance} wei does not sign or broadcast`, async t => {
  const h = await sellAffordabilityFixture(t, { balance });
  const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', () => {});
  console.log('SELL_SHORTAGE ' + JSON.stringify({ balance, status: batch.entries[0].status, error: batch.entries[0].error }));
  assert.equal(batch.entries[0].status, 'blocked');
  assert.match(batch.entries[0].error, /gas/);
  if (balance === '273277424449999') {
    assert.match(batch.entries[0].error, /upfront transaction gas.*shortfall 0.000000000000000001 ETH/);
    assert.ok(batch.entries[0].error.length < 300);
  }
  assert.equal(h.rpc.state.transactions.size, 0);
  const estimates = h.rpc.requests.filter(r => r.method === 'eth_estimateGas');
  assert.equal(estimates.length, 1);
  assert.equal(ethers.BigNumber.from(estimates[0].params[0].maxFeePerGas).toString(), '1671350000');
  assert.equal(ethers.BigNumber.from(estimates[0].params[0].maxPriorityFeePerGas).toString(), '1500000000');
  assert.equal(estimates[0].params[0].gasPrice, undefined, 'Sale estimation explicitly supplies reviewed EIP-1559 fees');
  assert.ok(h.rpc.requests.some(r => r.method === 'eth_getBalance' && r.params[1] === 'pending'));
});

for (const [phase, action, buffer] of [[0, 'approve-token', '0.00005'], [2, 'approve-token', '0.0001'], [2, 'approve-router', '0.00005']]) test(`sell affordability: phase ${phase} ${action} keeps its following-step reserve`, async t => {
  const h = await sellAffordabilityFixture(t, { phase, balance: eth('1').toString() });
  if (action === 'approve-token') h.rpc.state.allowance = eth('0');
  else h.rpc.state.permit = eth('0');
  const prepare = () => h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'sell', 100, () => {});
  const original = await prepare(); assert.equal(original.action, action);
  assert.equal(original.requiredRemainingEthWei, eth(buffer).toString());
  const needed = ethers.BigNumber.from(original.maxTotalEthWei).add(eth(buffer));
  h.rpc.state.balance = needed.sub(1);
  await assert.rejects(prepare(), error => {
    assert.match(error.message, /gas reserve for following steps/);
    assert.match(error.message, /shortfall 0.000000000000000001 ETH/);
    assert.ok(error.message.length < 300); return true;
  });
  h.rpc.state.balance = ethers.BigNumber.from(original.maxTotalEthWei).sub(1);
  await assert.rejects(prepare(), error => {
    assert.match(error.message, /upfront transaction gas/);
    assert.ok(error.message.includes(`need ${ethers.utils.formatEther(needed)}`));
    assert.ok(error.message.includes(`shortfall ${ethers.utils.formatEther(eth(buffer).add(1))} ETH`));
    assert.ok(error.message.includes(`reserve ${buffer}`));
    assert.ok(error.message.length < 300); return true;
  });
  assert.equal(h.rpc.state.transactions.size, 0);
  h.rpc.state.balance = needed; const review = await prepare();
  assert.equal(review.gasReserveWei, original.gasReserveWei);
  h.rpc.state.pendingBalance = needed.sub(1); let signs = 0;
  await assert.rejects(h.trading.executeTrade(h.session, review, () => {}, async () => { signs++; throw Error('unexpected signer'); }), /gas reserve for following steps/);
  assert.equal(signs, 0); assert.equal(h.rpc.state.transactions.size, 0);
  h.rpc.state.pendingBalance = needed;
  const operation = await h.trading.executeTrade(h.session, review, () => {}, tx => wallet.signTransaction(tx));
  assert.equal(operation.action, action); assert.equal(h.rpc.state.transactions.size, 1);
});

for (const [phase, actions] of [[0, ['buy', 'sell', 'approve-token']], [2, ['buy', 'sell', 'approve-token', 'approve-router']]]) {
  for (const action of actions) test(`phase ${phase} ${action}: tiny base rise keeps exact reviewed signed fees and one broadcast`, async t => {
    const h = await feeReview(t, { phase, action });
    h.rpc.state.feeBase = ethers.BigNumber.from('85020001').toHexString();
    const start = h.rpc.requests.length; let signs = 0;
    const sign = async tx => { signs++; return wallet.signTransaction(tx); };
    const operation = await h.trading.executeTrade(h.session, h.review, () => {}, sign);
    assert.equal(operation.action, action); assert.equal(operation.status, 'pending');
    assert.equal(signs, 1); assert.equal(h.rpc.state.transactions.size, 1); assert.equal(h.storage.size, 1);
    const tx = h.rpc.state.transactions.get(operation.txHash);
    assert.equal(tx.maxFeePerGas.toString(), h.review.maxFeePerGasWei);
    assert.equal(tx.maxPriorityFeePerGas.toString(), h.review.maxPriorityFeePerGasWei);
    assert.equal(tx.gasLimit.toString(), h.review.gasLimit);
    assert.equal(tx.value.add(tx.gasLimit.mul(tx.maxFeePerGas)).toString(), h.review.maxTotalEthWei);
    assert.equal(tx.nonce, 0); assert.equal(tx.chainId, 4663); assert.equal(tx.type, 2);
    assert.equal(h.rpc.requests.slice(start).filter(r => r.method === 'eth_getBlockByNumber').length, 1, 'The existing fee read supplies the base; no extra block read');
    await assert.rejects(h.trading.executeTrade(h.session, h.review, () => {}, sign), /already used/);
    assert.equal(signs, 1);
    assert.equal(h.rpc.requests.filter(r => r.method === 'eth_sendRawTransaction').length, 1, 'Approvals never advance into a sale');
  });
}

for (const base of ['0', '170040000']) test(`approval accepts nonnegative base ${base} within the full original tip boundary`, async t => {
  const h = await feeReview(t); h.rpc.state.feeBase = ethers.BigNumber.from(base).toHexString();
  await h.trading.executeTrade(h.session, h.review, () => {}, tx => wallet.signTransaction(tx));
  assert.equal(h.rpc.state.transactions.size, 1);
});

for (const scenario of [
  { name: 'one wei full-tip overflow', change: h => { h.rpc.state.feeBase = ethers.BigNumber.from('170040001').toHexString(); }, error: /base fee plus the reviewed priority fee exceeds/ },
  { name: 'missing base fee', change: h => { h.rpc.state.feeBase = null; }, error: /base fee could not be safely verified/ },
  { name: 'balance below maximum cost plus reserve', change: h => { h.rpc.state.balance = ethers.BigNumber.from(h.review.maxTotalEthWei).add(h.review.requiredRemainingEthWei).sub(1); }, error: /insufficient ETH.*reviewed cost and gas reserve/ },
  { name: 'both nonce views advance', change: h => h.rpc.setNonces(1, 1), error: /transaction nonce changed/ },
  { name: 'pending nonce differs from latest', change: h => h.rpc.setNonces(1, 0), error: /already has a pending Robinhood transaction/ },
  { name: 'estimate exceeds reviewed limit', change: h => { h.rpc.state.approvalGas = Number(h.review.gasLimit) + 1; }, error: /new gas estimate exceeds/ },
  { name: 'token holdings fall below reviewed amount', change: h => { h.rpc.state.holding = ethers.BigNumber.from(h.review.amountInRaw).sub(1); }, error: /token balance is below the reviewed amount/ },
]) test(`approval rejects ${scenario.name} with a specific reason before signing`, async t => {
  const h = await feeReview(t); scenario.change(h); let signs = 0;
  await assert.rejects(h.trading.executeTrade(h.session, h.review, () => {}, async () => { signs++; throw Error('unexpected signer'); }), scenario.error);
  assert.equal(signs, 0); assert.equal(h.storage.size, 0);
  assert.equal(h.rpc.requests.filter(r => r.method === 'eth_sendRawTransaction').length, 0);
});

test('approval at the fixed fee cap preserves unknown-outcome recovery without retry', async t => {
  const h = await feeReview(t); h.rpc.state.feeBase = ethers.BigNumber.from('85020001').toHexString();
  h.rpc.rejectMethod('eth_sendRawTransaction'); let signs = 0;
  const sign = async tx => { signs++; return wallet.signTransaction(tx); };
  const operation = await h.trading.executeTrade(h.session, h.review, () => {}, sign);
  assert.equal(operation.status, 'unknown'); assert.equal(h.storage.size, 1);
  assert.equal(h.trading.getNodeTradeOperation(wallet.address).txHash, operation.txHash);
  await assert.rejects(h.trading.executeTrade(h.session, h.review, () => {}, sign), /already used/);
  await assert.rejects(h.trading.prepareTrade(h.session, 0, wallet.address, TOKEN, 'sell', 100, () => {}), /unresolved Robinhood transaction/);
  assert.equal(signs, 1); assert.equal(h.rpc.requests.filter(r => r.method === 'eth_sendRawTransaction').length, 1);
});


test('actual batch renewal retains curve identity and rejects a changed underlying curve', async t => {
  const rpc = await loopbackRpc({ delayMs: 0 }); t.after(() => rpc.close()); let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const h = actualProviderTrading(rpc.url, { clock: Clock });
  const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'buy', () => {});
  now += 46000; rpc.state.curve = ethers.utils.getAddress('0x'+'44'.repeat(20));
  const results = await h.batch.executeNodeTradeBatch(h.session, batch, () => {});
  assert.equal(results[0].status, 'error'); assert.match(results[0].error, /launch route changed/);
  assert.equal(rpc.state.transactions.size, 0);
  await assert.rejects(h.trading.executeTrade(h.session, batch.entries[0].review, () => {}, tx => wallet.signTransaction(tx)), /invalid|used/);
});
test('actual Permit2 renewal keeps amount and spender with a fresh bounded approval lifetime', async t => {
  const rpc = await loopbackRpc({ delayMs: 0, phase: 2 }); t.after(() => rpc.close()); let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const h = actualProviderTrading(rpc.url, { clock: Clock }); rpc.state.holding = eth('100'); rpc.state.allowance = eth('100');
  const batch = await h.batch.prepareNodeTradeBatch(h.session, TOKEN, 'sell', () => {});
  assert.equal(batch.entries[0].review.action, 'approve-router');
  const originalExpiry = batch.entries[0].review.approvalExpiresAt; now += 46000;
  const results = await h.batch.executeNodeTradeBatch(h.session, batch, () => {});
  assert.equal(results[0].status, 'submitted', results[0].error); assert.equal(results[0].renewed, true);
  rpc.mine(results[0].operation.txHash);
  assert.equal(rpc.state.permit.toString(), eth('100').toString());
  assert.equal(rpc.state.permitExpiration * 1000, originalExpiry + 46000);
  assert.equal((await h.trading.refreshNodeTradeOperation(wallet.address)).status, 'confirmed');
  assert.equal(rpc.state.transactions.size, 1); assert.equal(results[0].operation.action, 'approve-router');
});
