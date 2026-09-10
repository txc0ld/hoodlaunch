const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function client(fetch) {
 const module = { exports: {} };
 const code = ts.transpileModule(fs.readFileSync('src/lib/node-generation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortSignal, Date });
 return module.exports;
}
const identity = 'a'.repeat(64), id = '33333333-3333-4333-8333-333333333333';
const reservation = { reserved: true, sessionIdentity: identity, requestId: id, count: 1, reservedAt: '2026-09-11T00:00:00Z', nextEligibleAt: '2026-09-12T00:00:00Z' };
test('generation request sends only public reservation fields and binds returned identity', async () => {
 let sent;
 const { nodeGenerationRequest } = client(async (_, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => reservation }; });
 await nodeGenerationRequest(identity, { requestId: id, count: 1, session: { sensitive: 'must never leave browser' } });
 assert.deepEqual(sent, { action: 'reserve', expectedSessionIdentity: identity, requestId: id, count: 1 });
 for (const body of [{ ...reservation, sessionIdentity: 'b'.repeat(64) }, { ...reservation, count: 50 }, { ...reservation, requestId: 'other' }, { ...reservation, reservedAt: 'bad' }, { ...reservation, reserved: false }]) {
  await assert.rejects(client(async () => ({ ok: true, json: async () => body })).nodeGenerationRequest(identity, { requestId: id, count: 1 }));
 }
});
test('unknown response retry preserves caller request and status validates current allowance', async () => {
 const requests = [];
 const { nodeGenerationRequest } = client(async (_, options) => { requests.push(JSON.parse(options.body)); if (requests.length === 1) throw new Error('lost response'); return { ok: true, json: async () => reservation }; });
 const attempt = { requestId: id, count: 1 };
 await assert.rejects(nodeGenerationRequest(identity, attempt));
 await nodeGenerationRequest(identity, attempt);
 assert.deepEqual(requests[0], requests[1]);
 for (const body of [{ enabled: true, available: true, maxCount: 51, nextEligibleAt: null, sessionIdentity: identity }, { enabled: false, available: true, maxCount: 1, nextEligibleAt: null, sessionIdentity: identity }]) {
  await assert.rejects(client(async () => ({ ok: true, json: async () => body })).nodeGenerationRequest(identity));
 }
});
