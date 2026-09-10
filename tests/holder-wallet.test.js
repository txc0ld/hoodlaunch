const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');
const { Wallet, utils } = require('ethers');
function load(file) {
  const filename = path.resolve(file), module = { exports: {} }, native = createRequire(filename);
  const require = name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : native(name);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: module.exports, module, require, URL }, { filename });
  return module.exports;
}
const { verifyHolderWallet } = load('src/lib/holder-wallet.ts');
// Public, deterministic inert test key. No provider or network is attached.
const signer = new Wallet('0x' + '19'.repeat(32));
const origin = 'https://launch.hoodrich.rip';
function fixture() {
  const calls = [], accountCalls = [];
  let address = signer.address, chain = '0x1237', active = true;
  const challenge = { challengeId: 'a'.repeat(64), address, chainId: 4663,
    message: `${new URL(origin).host} wants you to sign in with your Ethereum account:\n${address}\n\nVerify HOODRICH holder access.\n\nURI: ${origin}/\nVersion: 1\nChain ID: 4663\nNonce: ${'a'.repeat(32)}\nIssued At: 2026-09-10T00:00:00.000Z\nExpiration Time: 2026-09-10T00:05:00.000Z` };
  const wallet = { async request(args) {
    calls.push(args);
    if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') return [address];
    if (args.method === 'eth_chainId') return chain;
    if (args.method === 'personal_sign') return signer.signMessage(utils.arrayify(args.params[0]));
    throw Error('Unexpected wallet operation: ' + args.method);
  }};
  const request = async (action, data) => { accountCalls.push({ action, data }); return action === 'holder-challenge' ? challenge : { verified: true }; };
  const check = () => { if (!active) throw Error('closed'); };
  return { calls, accountCalls, challenge, wallet, request, check,
    setAddress(value) { address = value; }, setChain(value) { chain = value; }, close() { active = false; } };
}
test('holder verification signs exact site-bound message once and submits no transaction or approval', async () => {
  const f = fixture(); await verifyHolderWallet(f.wallet, origin, f.request, f.check);
  assert.deepEqual(f.accountCalls.map(v => v.action), ['holder-challenge', 'holder-verify']);
  assert.equal(f.accountCalls[0].data.address, signer.address);
  assert.equal(utils.verifyMessage(f.challenge.message, f.accountCalls[1].data.signature), signer.address);
  assert.deepEqual(Object.keys(f.accountCalls[1].data).sort(), ['challengeId', 'signature']);
  assert.equal(f.calls.filter(v => v.method === 'personal_sign').length, 1);
  assert.ok(f.calls.every(v => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'personal_sign'].includes(v.method)));
});
for (const [label, mutate] of [
  ['foreign domain', f => f.challenge.message = f.challenge.message.replace('launch.hoodrich.rip wants', 'attacker.example wants')],
  ['foreign URI', f => f.challenge.message = f.challenge.message.replace(`URI: ${origin}/`, 'URI: https://attacker.example/')],
  ['wrong chain', f => f.challenge.chainId = 1],
  ['wrong message chain', f => f.challenge.message = f.challenge.message.replace('Chain ID: 4663', 'Chain ID: 1')],
  ['wrong address', f => f.challenge.address = '0x' + '11'.repeat(20)],
  ['oversized message', f => f.challenge.message += 'a'.repeat(4096)],
]) test(`reject ${label} before signature`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(verifyHolderWallet(f.wallet, origin, f.request, f.check));
  assert.equal(f.calls.some(v => v.method === 'personal_sign'), false);
  assert.equal(f.accountCalls.some(v => v.action === 'holder-verify'), false);
});
test('wrong connected chain never obtains a challenge or signature', async () => {
  const f = fixture(); f.setChain('0x1');
  await assert.rejects(verifyHolderWallet(f.wallet, origin, f.request, f.check), /Robinhood/);
  assert.equal(f.accountCalls.length, 0);
});
for (const phase of ['challenge', 'signature']) for (const change of ['account', 'chain', 'close']) {
  test(`${change} change during ${phase} prevents proof submission`, async () => {
    const f = fixture(), oldRequest = f.request, oldWalletRequest = f.wallet.request;
    const mutate = () => change === 'account' ? f.setAddress('0x' + '22'.repeat(20)) : change === 'chain' ? f.setChain('0x1') : f.close();
    const request = async (...args) => { const result = await oldRequest(...args); if (phase === 'challenge') mutate(); return result; };
    f.wallet.request = async args => { const result = await oldWalletRequest(args); if (phase === 'signature' && args.method === 'personal_sign') mutate(); return result; };
    await assert.rejects(verifyHolderWallet(f.wallet, origin, request, f.check));
    assert.equal(f.accountCalls.some(v => v.action === 'holder-verify'), false);
    if (phase === 'challenge') assert.equal(f.calls.some(v => v.method === 'personal_sign'), false);
  });
}
test('wallet rejection is surfaced without proof submission or retry', async () => {
  const f = fixture(), old = f.wallet.request;
  f.wallet.request = async args => { if (args.method === 'personal_sign') throw Error('User rejected'); return old(args); };
  await assert.rejects(verifyHolderWallet(f.wallet, origin, f.request, f.check), /User rejected/);
  assert.equal(f.accountCalls.length, 1);
});
