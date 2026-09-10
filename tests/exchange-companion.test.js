const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {plan, decimal, hash} = require('../companion/model.cjs');
const {openState} = require('../companion/state.cjs');
const {requester, krakenSignature, ORIGINS} = require('../companion/transport.cjs');
const {createExchange} = require('../companion/exchanges.cjs');
const {prepare, execute, history} = require('../companion/operations.cjs');
const A = '0x' + '12'.repeat(20);
const inert = {KRAKEN_API_KEY: 'inert-test-key', KRAKEN_API_SECRET: Buffer.alloc(64, 7).toString('base64'), BINANCE_API_KEY: 'inert-binance-key', BINANCE_API_SECRET: 'inert-binance-secret', OKX_API_KEY: 'inert-okx-key', OKX_API_SECRET: 'inert-okx-secret', OKX_API_PASSPHRASE: 'inert-okx-passphrase'};
function input() { return {version: 1, id: '5bf5bf52-b718-4ac5-aec1-01f367d04b39', sourceChainId: 1, asset: 'ETH', createdAt: '2026-09-10T00:00:00.000Z', nodes: [{index: 1, address: A, amountEth: '0.01', withdrawalKey: 'node-one'}]}; }
async function setup(t, provider = 'kraken', options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoodlabs-exchange-test-')); fs.chmodSync(dir, 0o700);
  const stateDir = path.join(dir, 'state'); const state = openState(stateDir), calls = [], controls = {};
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const url = new URL(req.url, 'http://mock.test'), params = new URLSearchParams(body), rpc = req.headers['content-type'] === 'application/json' ? JSON.parse(body) : null;
    const call = {path: url.pathname, params, headers: req.headers, body}; calls.push(call);
    let result;
    if (options.respond) { const special = await options.respond(call, res); if (special === false) return; }
    if (url.pathname === '/') result = {jsonrpc: '2.0', id: 1, result: rpc.method === 'eth_chainId' ? (controls.wrongChain ? '0x1237' : '0x1') : controls.hasCode ? '0x6000' : '0x'};
    else if (url.pathname.startsWith('/0/private/')) {
      assert.equal(req.headers['api-key'], inert.KRAKEN_API_KEY);
      assert.equal(req.headers['api-sign'], krakenSignature(url.pathname, params.get('nonce'), body, inert.KRAKEN_API_SECRET));
      switch (url.pathname.split('/').pop()) {
        case 'GetApiKeyInfo': result = {permissions: controls.noPermission ? ['query-funds'] : ['query-funds', 'withdraw-funds']}; break;
        case 'WithdrawMethods': result = [{asset: 'XETH', network: controls.wrongNetwork ? 'Arbitrum One' : 'Ethereum', method: 'Ether', minimum: '0.001'}]; break;
        case 'WithdrawAddresses': result = [{asset: 'XETH', method: 'Ether', key: 'node-one', address: controls.wrongAddress ? '0x' + '34'.repeat(20) : A, verified: !controls.unverified}]; break;
        case 'WithdrawInfo': result = {method: 'Ether', amount: controls.badNet ? '0.01' : controls.feeChanged ? '0.008' : '0.009', fee: controls.feeChanged ? '0.002' : '0.001', limit: controls.lowLimit ? '0.001' : '1'}; break;
        case 'Withdraw':
          assert.equal(params.get('address'), A); assert.equal(params.get('max_fee'), '0.001'); assert.equal(params.get('amount'), '0.01');
          assert.equal(state.read('destination-' + hash(A)).status, 'unknown', 'durable marker is visible before the actual HTTP POST');
          if (controls.drop) { req.socket.destroy(); return; }
          result = controls.badResponse ? {} : {refid: 'FT-inert-test-123'}; break;
        case 'WithdrawStatus': result = [{refid: 'FT-inert-test-123', status: 'Success', txid: '0x' + 'ab'.repeat(32)}]; break;
        default: assert.fail('Unexpected path ' + url.pathname);
      }
      result = {error: controls.exchangeError ? ['EFunding:Travel rule information required'] : [], result};
    } else if (url.pathname.startsWith('/sapi/')) {
      assert.equal(req.method, 'GET'); assert.equal(req.headers['x-mbx-apikey'], inert.BINANCE_API_KEY);
      const signature = url.searchParams.get('signature'); url.searchParams.delete('signature');
      assert.equal(signature, crypto.createHmac('sha256', inert.BINANCE_API_SECRET).update(url.searchParams.toString()).digest('hex'));
      if (url.pathname.endsWith('apiRestrictions')) result = {enableReading: true, enableWithdrawals: false};
      else if (url.pathname.endsWith('getall')) result = [{coin: 'ETH', withdrawAllEnable: true, networkList: [{network: 'ETH', coin: 'ETH', contractAddress: '', withdrawFee: '0.001', withdrawMin: '0.002', withdrawMax: '10', withdrawIntegerMultiple: '0.0001', withdrawEnable: true, busy: false, withdrawTag: false}]}];
      else if (url.pathname.endsWith('list')) result = [{coin: 'ETH', network: 'ETH', address: A, whiteStatus: true, addressTag: ''}];
      else if (url.pathname.endsWith('questionnaire-requirements')) result = controls.travelRequired ? 'US' : 'NIL';
      else assert.fail('Unexpected Binance read');
    } else if (url.pathname.startsWith('/api/v5/')) {
      assert.equal(req.method, 'GET'); assert.equal(req.headers['ok-access-key'], inert.OKX_API_KEY);
      assert.equal(req.headers['ok-access-sign'], crypto.createHmac('sha256', inert.OKX_API_SECRET).update(req.headers['ok-access-timestamp'] + 'GET' + req.url).digest('base64'));
      if (url.pathname.endsWith('/config')) result = [{perm: 'read_only'}];
      else if (url.pathname.endsWith('/currencies')) result = [{ccy: 'ETH', chain: 'ETH-ERC20', ctAddr: '', fee: '0.001', minWd: '0.002', maxWd: '10', canWd: true, needTag: false}];
      else if (url.pathname.endsWith('/balances')) result = [{ccy: 'ETH', availBal: '1'}];
      else assert.fail('Unexpected OKX read');
      result = {code: '0', data: result};
    } else assert.fail('Unexpected endpoint');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const request = requester((url, requestOptions, callback) => {
    assert.ok(Object.values(ORIGINS).includes(url.origin));
    return http.request({hostname: '127.0.0.1', port: server.address().port, path: url.pathname + url.search, ...requestOptions}, callback);
  }, options.timeout || 1000);
  let now = 1800000000000;
  const exchange = createExchange(provider, state, {env: inert, request, now: () => now});
  t.after(async () => { state.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(dir, {recursive: true, force: true}); });
  return {state, stateDir, dir, exchange, calls, controls, request, now: () => now, advance: n => { now += n; }};
}
const live = {HOODLAUNCH_EXCHANGE_LIVE: 'true'};
async function review(h) { return prepare(h.state, h.exchange, input(), 1, '0.01', h.now); }
async function send(h, r) { return execute(h.state, h.exchange, r.id, r.confirmation, {env: live, now: h.now}); }
function withdrawals(h) { return h.calls.filter(c => c.path === '/0/private/Withdraw'); }

test('exact 18-decimal amounts, 50 unique nodes, strict chain/asset/key-only public schema', () => {
  assert.equal(decimal('0.000000000000000001'), 1n);
  for (const bad of ['1e-3', '01', '-1', '0.0000000000000000001', 0.1, 'NaN']) assert.throws(() => decimal(bad));
  const p = input(); p.nodes = Array.from({length: 50}, (_, i) => ({index: i + 1, address: '0x' + (i + 1).toString(16).padStart(40, '0'), amountEth: '0.01'}));
  assert.equal(plan(p).nodes.length, 50); p.nodes.push({index: 51}); assert.throws(() => plan(p), /1 to 50/);
  for (const mutation of [p => p.sourceChainId = 4663, p => p.asset = 'WETH', p => p.nodes[0].privateKey = 'never-allowed', p => p.nodes[0].address = '0x' + '00'.repeat(20), p => p.nodes.push({...p.nodes[0], index: 2}), p => p.nodes[0].amountEth = '0']) { const p = input(); mutation(p); assert.throws(() => plan(p)); }
});
test('Kraken published HMAC-SHA512 signature vector', () => {
  const secret = 'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==';
  assert.equal(krakenSignature('/0/private/AddOrder', '1616492376594', 'nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25', secret), '4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==');
});
test('actual HTTP: review binds exact fee/net/address and one durable submission, never settlement', async t => {
  const h = await setup(t), r = await review(h);
  assert.equal(r.quote.netEth, '0.009'); assert.equal(r.quote.maximumDebitEth, '0.01'); assert.equal(withdrawals(h).length, 0);
  assert.equal((fs.statSync(path.join(h.stateDir, 'review-' + r.id + '.json')).mode & 0o777), 0o600);
  const result = await send(h, r); assert.equal(result.status, 'accepted'); assert.match(result.reason, /not on-chain settlement/);
  assert.equal(withdrawals(h).length, 1);
  await assert.rejects(() => send(h, r), /already has a submission/);
  const edited = input(); edited.id = crypto.randomUUID(); edited.nodes[0].amountEth = '0.02';
  await assert.rejects(() => prepare(h.state, h.exchange, edited, 1, '0.1', h.now), /already has a submission/);
  assert.equal((await history(h.state, h.exchange, r.id)).status, 'Success'); assert.equal(withdrawals(h).length, 1);
});
test('default-off, mismatched confirmation and over-budget review cannot submit', async t => {
  const h = await setup(t), r = await review(h);
  await assert.rejects(() => execute(h.state, h.exchange, r.id, r.confirmation, {env: {}, now: h.now}), /disabled/);
  await assert.rejects(() => execute(h.state, h.exchange, r.id, 'yes', {env: live, now: h.now}), /confirmation/);
  await assert.rejects(() => prepare(h.state, h.exchange, input(), 1, '0.009', h.now), /maximum debit/);
  assert.equal(withdrawals(h).length, 0);
});
test('permission, wrong network, non-EOA, address mapping, unverified key, ambiguous fees and limits fail before POST', async t => {
  const h = await setup(t);
  for (const flag of ['noPermission', 'wrongNetwork', 'wrongChain', 'hasCode', 'wrongAddress', 'unverified', 'badNet', 'lowLimit', 'exchangeError']) {
    h.controls[flag] = true; await assert.rejects(() => review(h)); delete h.controls[flag];
  }
  assert.equal(withdrawals(h).length, 0);
});
test('fresh preflight fee drift, changed review and expiry cannot submit', async t => {
  const h = await setup(t), r = await review(h);
  h.controls.feeChanged = true; await assert.rejects(() => send(h, r), /details or fee changed/); delete h.controls.feeChanged;
  h.advance(300000); await assert.rejects(() => send(h, r), /expired/);
  const changed = h.state.read('review-' + r.id); changed.quote.address = '0x' + '34'.repeat(20); h.state.write('review-' + r.id, changed);
  await assert.rejects(() => send(h, r), /changed/); assert.equal(withdrawals(h).length, 0);
});
test('uncertain socket disconnect persists across invocation and altered plan, API key or amount', async t => {
  const h = await setup(t), r = await review(h); h.controls.drop = true;
  assert.equal((await send(h, r)).status, 'unknown'); assert.equal(withdrawals(h).length, 1);
  h.state.close(); const reopened = openState(h.stateDir);
  try {
    const changed = input(); changed.id = crypto.randomUUID(); changed.nodes[0].amountEth = '0.03';
    const otherKey = createExchange('kraken', reopened, {env: {...inert, KRAKEN_API_KEY: 'rotated-inert-key'}, request: h.request});
    await assert.rejects(() => prepare(reopened, otherKey, changed, 1, '1', h.now), /already has a submission/);
    assert.equal((await history(reopened, h.exchange, r.id)).status, 'unknown');
  } finally { reopened.close(); }
  assert.equal(withdrawals(h).length, 1);
});
test('ambiguous success response remains unknown and duplicate-blocked', async t => {
  const h = await setup(t), r = await review(h); h.controls.badResponse = true;
  assert.equal((await send(h, r)).status, 'unknown'); await assert.rejects(() => send(h, r), /already has a submission/); assert.equal(withdrawals(h).length, 1);
});
test('durable intent write failure prevents the withdrawal request', async t => {
  const h = await setup(t), r = await review(h), original = h.state.write;
  h.state.write = (key, value) => { if (key.startsWith('destination-')) throw Error('mock disk full'); return original(key, value); };
  await assert.rejects(() => send(h, r), /disk full/); h.state.write = original;
  assert.equal(withdrawals(h).length, 0); await assert.rejects(() => send(h, r), /already has a submission/);
});
test('state locks serialize processes; nonce survives clock rollback; symlinks and public file modes fail closed', async t => {
  const h = await setup(t);
  assert.throws(() => openState(h.stateDir), /locked/);
  const account = hash('test'); h.state.write('nonce-' + account, {value: '999999999999999999'});
  assert.equal(h.state.nonce(account), '1000000000000000000');
  const target = path.join(h.stateDir, 'bad.json'); fs.symlinkSync('/dev/null', target); assert.throws(() => h.state.read('bad'), /Unsafe/);
  fs.writeFileSync(path.join(h.stateDir, 'public.json'), '{}', {mode: 0o644}); assert.throws(() => h.state.read('public'), /unreadable/);
  const link = path.join(h.dir, 'link'); fs.symlinkSync(h.stateDir, link); assert.throws(() => openState(link), /real directories/);
});
test('redirect cannot forward credentials to another exchange; timeout never retries', async t => {
  const h = await setup(t, 'kraken', {respond(call, res) { if (call.path === '/0/private/GetApiKeyInfo') { res.writeHead(302, {Location: 'https://www.okx.com/api/v5/account/config'}); res.end(); return false; } }});
  await assert.rejects(() => review(h), /redirect/); assert.equal(h.calls.filter(c => c.path.startsWith('/0/')).length, 1);
  const slow = await setup(t, 'kraken', {timeout: 30, respond(call) { if (call.path === '/0/private/GetApiKeyInfo') return false; }});
  await assert.rejects(() => review(slow), /timed out/); assert.equal(slow.calls.filter(c => c.path.startsWith('/0/')).length, 1);
  assert.throws(() => h.request('kraken', '//evil.test/0/private/Withdraw'), /not allowed/);
  assert.throws(() => h.request('okx', '/api/v5/asset/withdrawal', {method: 'POST'}), /not allowed/);
});
for (const provider of ['binance', 'okx']) test(`${provider} signed read-only inspection is explicit about its limitations and has no withdrawal path`, async t => {
  const h = await setup(t, provider), result = await h.exchange.inspect(plan(input()).nodes[0]);
  assert.equal(result.available, false); assert.match(result.reason, /Read-only connection/); assert.equal(result.networkEnabled, true); assert.equal(result.withdrawalPermission, false);
  await assert.rejects(() => prepare(h.state, h.exchange, input(), 1, '1', h.now), /inspection only/);
  await assert.rejects(() => h.exchange.withdraw(result), /unavailable/);
  assert.ok(h.calls.every(c => !c.path.includes('Withdraw') && !c.path.endsWith('/withdrawal')));
});
test('fsync failure before submission fails closed, without a withdrawal POST', async t => {
  const h = await setup(t), r = await review(h), original = fs.fsyncSync;
  // The fresh preflight persists a nonce first. Losing durable storage there must prevent every subsequent request.
  const before = h.calls.length;
  fs.fsyncSync = () => { throw Error('mock fsync failure'); };
  try { await assert.rejects(() => send(h, r), /fsync failure/); } finally { fs.fsyncSync = original; }
  assert.equal(withdrawals(h).length, 0); assert.equal(h.calls.length, before + 2, 'only public chain/EOA RPC completed; no new exchange call');
});
test('dangling symlink writes, hard links and null/corrupt state cannot erase duplicate barriers', async t => {
  const h = await setup(t), marker = 'destination-' + hash(A), target = path.join(h.stateDir, marker + '.json');
  fs.writeFileSync(target, 'null', {mode: 0o600}); await assert.rejects(() => review(h), /unreadable/);
  fs.unlinkSync(target); fs.symlinkSync(path.join(h.stateDir, 'missing'), target);
  assert.throws(() => h.state.write(marker, {}), /Unsafe/);
  fs.unlinkSync(target); fs.writeFileSync(target, '{}', {mode: 0o600}); fs.linkSync(target, path.join(h.stateDir, 'hardlink.json'));
  assert.throws(() => h.state.read(marker), /unreadable/);
});
test('plan is copied before asynchronous inspection; rechecked key/account and clock rollback cannot submit', async t => {
  const h = await setup(t), p = input(), pending = prepare(h.state, h.exchange, p, 1, '0.01', h.now);
  p.nodes[0].address = '0x' + '34'.repeat(20); p.nodes[0].amountEth = '1';
  const r = await pending; assert.equal(r.plan.nodes[0].address, A); assert.equal(r.quote.requestEth, '0.01');
  h.advance(-1); await assert.rejects(() => send(h, r), /expired/); h.advance(1);
  const other = createExchange('kraken', h.state, {env: {...inert, KRAKEN_API_KEY: 'different-inert-key'}, request: h.request});
  await assert.rejects(() => execute(h.state, other, r.id, r.confirmation, {env: live, now: h.now}), /another exchange key/);
  assert.equal(withdrawals(h).length, 0);
});
