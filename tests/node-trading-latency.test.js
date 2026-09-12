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
]);

function encodeResult(contractInterface, name, values) {
  return contractInterface.encodeFunctionResult(name, values);
}

function callResult(transaction, curveTokenReserve = eth('1000000')) {
  const selector = transaction.data.slice(0, 10);
  if (selector === factoryInterface.getSighash('getLaunchedToken')) {
    return encodeResult(factoryInterface, 'getLaunchedToken', [[
      TOKEN, CURVE, wallet.address, wallet.address, ethers.constants.AddressZero,
      eth('100'), 0, 200, 0, false, 0, 0, 0, 0, true,
    ]]);
  }
  const curveResults = new Map([
    [curveInterface.getSighash('token'), ['token', [TOKEN]]],
    [curveInterface.getSighash('pairToken'), ['pairToken', [ethers.constants.AddressZero]]],
    [curveInterface.getSighash('isNativeQuote'), ['isNativeQuote', [true]]],
    [curveInterface.getSighash('readyToGraduate'), ['readyToGraduate', [false]]],
    [curveInterface.getSighash('graduated'), ['graduated', [false]]],
    [curveInterface.getSighash('getReserves'), ['getReserves', [eth('100'), curveTokenReserve]]],
    [curveInterface.getSighash('sellableTokens'), ['sellableTokens', [eth('900000')]]],
    [curveInterface.getSighash('feeBps'), ['feeBps', [100]]],
    [curveInterface.getSighash('creatorTaxBps'), ['creatorTaxBps', [0]]],
    [curveInterface.getSighash('currentSnipeTaxBps'), ['currentSnipeTaxBps', [0]]],
  ]);
  const curve = curveResults.get(selector);
  if (curve) return encodeResult(curveInterface, curve[0], curve[1]);
  const tokenResults = new Map([
    [tokenInterface.getSighash('balanceOf'), ['balanceOf', [eth('100')]]],
    [tokenInterface.getSighash('symbol'), ['symbol', ['TST']]],
    [tokenInterface.getSighash('decimals'), ['decimals', [18]]],
  ]);
  const token = tokenResults.get(selector);
  if (token) return encodeResult(tokenInterface, token[0], token[1]);
  return '0x';
}

async function loopbackRpc({ delayMs = 5, chainId = '0x1237' } = {}) {
  const requests = [];
  let currentChainId = chainId;
  let chainIdResponses = [];
  let pendingNonce = 0;
  let latestNonce = 0;
  let curveTokenReserve = eth('1000000');
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
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_getBalance') return eth('1').toHexString();
    if (method === 'eth_getTransactionCount') return ethers.utils.hexValue(params[1] === 'pending' ? pendingNonce : latestNonce);
    if (method === 'eth_getCode') return runtimes[params[0].toLowerCase()] || '0x1234';
    if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_gasPrice') return '0x77359400';
    if (method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_call') return callResult(params[0], curveTokenReserve);
    if (method === 'eth_sendRawTransaction') return ethers.utils.keccak256(params[0]);
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
    requests,
    url: `http://127.0.0.1:${address.port}`,
    setChainId: value => { currentChainId = value; },
    setChainIdResponses: values => { chainIdResponses = [...values]; },
    setNonces: (pending, latest) => { pendingNonce = pending; latestNonce = latest; },
    setCurveTokenReserve: value => { curveTokenReserve = value; },
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
    Date,
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
    navigator: { locks: { request: async (_name, _options, callback) => callback({ name: 'fixture-lock' }) } },
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

  return load('node-trading');
}

test('full buy uses only the four explicit chain guards with the configured provider', async t => {
  const rpc = await loopbackRpc();
  t.after(() => rpc.close());
  const trading = actualProviderTrading(rpc.url);
  const owner = {};
  const assertActive = () => {};
  const started = performance.now();
  const review = await trading.prepareTrade(owner, 0, wallet.address, TOKEN, 'buy', 5, assertActive);
  const operation = await trading.executeTrade(owner, review, assertActive, tx => wallet.signTransaction(tx));
  const elapsedMs = Math.round(performance.now() - started);
  const chainIdRequests = rpc.requests.filter(request => request.method === 'eth_chainId').length;
  const evidence = { elapsedMs, requests: rpc.requests.length, chainIdRequests, delayMs: 5 };
  console.log(`LOOPBACK_BUY_RPC ${JSON.stringify(evidence)}`);

  assert.equal(operation.status, 'pending');
  assert.equal(rpc.requests.filter(request => request.method === 'eth_sendRawTransaction').length, 1);
  assert.equal(chainIdRequests, 4, `hidden provider detection added ${chainIdRequests - 4} chain ID requests`);
});

test('initial explicit chain guard rejects the loopback before trade reads', async t => {
  const rpc = await loopbackRpc({ chainId: '0x1' });
  t.after(() => rpc.close());
  const trading = actualProviderTrading(rpc.url);
  await assert.rejects(
    trading.prepareTrade({}, 0, wallet.address, TOKEN, 'buy', 5, () => {}),
    /wrong network/i,
  );
  assert.deepEqual(rpc.requests.map(request => request.method).sort(), ['eth_blockNumber', 'eth_chainId']);
});

test('final execution chain guard catches a network change before signing or broadcasting', async t => {
  const rpc = await loopbackRpc();
  t.after(() => rpc.close());
  const trading = actualProviderTrading(rpc.url);
  const owner = {};
  const review = await trading.prepareTrade(owner, 0, wallet.address, TOKEN, 'buy', 5, () => {});
  rpc.setChainIdResponses(['0x1237', '0x1']);
  let signs = 0;
  await assert.rejects(
    trading.executeTrade(owner, review, () => {}, async () => { signs += 1; return '0x'; }),
    /wrong network/i,
  );
  assert.equal(signs, 0);
  assert.equal(rpc.requests.filter(request => request.method === 'eth_sendRawTransaction').length, 0);
});

test('provider rejection and pending nonce fail closed on the actual provider path', async t => {
  await t.test('provider rejection', async t => {
    const rpc = await loopbackRpc();
    t.after(() => rpc.close());
    rpc.rejectMethod('eth_getBalance');
    const trading = actualProviderTrading(rpc.url);
    await assert.rejects(trading.prepareTrade({}, 0, wallet.address, TOKEN, 'buy', 5, () => {}));
    assert.equal(rpc.requests.filter(request => request.method === 'eth_sendRawTransaction').length, 0);
  });
  await t.test('pending nonce', async t => {
    const rpc = await loopbackRpc();
    t.after(() => rpc.close());
    rpc.setNonces(1, 0);
    const trading = actualProviderTrading(rpc.url);
    await assert.rejects(
      trading.prepareTrade({}, 0, wallet.address, TOKEN, 'buy', 5, () => {}),
      /pending Robinhood transaction/i,
    );
    assert.equal(rpc.requests.filter(request => request.method === 'eth_sendRawTransaction').length, 0);
  });
});

test('fresh price, storage, and cancellation guards still prevent broadcast', async t => {
  await t.test('moved price', async t => {
    const rpc = await loopbackRpc();
    t.after(() => rpc.close());
    const trading = actualProviderTrading(rpc.url);
    const owner = {};
    const review = await trading.prepareTrade(owner, 0, wallet.address, TOKEN, 'buy', 5, () => {});
    rpc.setCurveTokenReserve(eth('950000'));
    let signs = 0;
    await assert.rejects(
      trading.executeTrade(owner, review, () => {}, async () => { signs += 1; return '0x'; }),
      /price changed/i,
    );
    assert.equal(signs, 0);
    assert.equal(rpc.requests.filter(request => request.method === 'eth_sendRawTransaction').length, 0);
  });
  await t.test('storage failure', async t => {
    const rpc = await loopbackRpc();
    t.after(() => rpc.close());
    const trading = actualProviderTrading(rpc.url, { storageFail: true });
    const owner = {};
    const review = await trading.prepareTrade(owner, 0, wallet.address, TOKEN, 'buy', 5, () => {});
    await assert.rejects(
      trading.executeTrade(owner, review, () => {}, tx => wallet.signTransaction(tx)),
      /persist trading recovery/i,
    );
    assert.equal(rpc.requests.filter(request => request.method === 'eth_sendRawTransaction').length, 0);
  });
  await t.test('selection cancellation at final guard', async t => {
    const rpc = await loopbackRpc();
    t.after(() => rpc.close());
    const trading = actualProviderTrading(rpc.url);
    const owner = {};
    let active = true;
    const assertActive = () => { if (!active) throw new Error('fixture selection cancelled'); };
    const review = await trading.prepareTrade(owner, 0, wallet.address, TOKEN, 'buy', 5, assertActive);
    let executionChainReads = 0;
    rpc.setOnRequest(entry => {
      if (entry.method === 'eth_chainId' && ++executionChainReads === 2) active = false;
    });
    let signs = 0;
    await assert.rejects(
      trading.executeTrade(owner, review, assertActive, async () => { signs += 1; return '0x'; }),
      /selection cancelled/i,
    );
    assert.equal(signs, 0);
    assert.equal(rpc.requests.filter(request => request.method === 'eth_sendRawTransaction').length, 0);
  });
});
