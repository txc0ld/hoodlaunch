const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');

const envKeys = ['APP_ORIGIN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, {
  APP_ORIGIN: 'https://launch.example.com',
  SUPABASE_URL: 'https://quota-test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
});
test.after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function load(file, globals) {
  const filename = path.resolve(file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const actual = createRequire(filename);
  const req = name => name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(filename), name + '.ts'))
    ? load(path.resolve(path.dirname(filename), name + '.ts'), globals)
    : actual(name);
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: req,
    process,
    Buffer,
    URL,
    FormData,
    Blob,
    fetch: globals.fetch,
    AbortSignal: globals.AbortSignal,
    setTimeout: globals.setTimeout,
    clearTimeout,
    Error,
    TypeError,
    console,
  }, { filename });
  return module.exports;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function failedBodyResponse(error) {
  return new Response(new ReadableStream({ pull(controller) { controller.error(error); } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function harness(replies) {
  const calls = [];
  const deadlines = [];
  const waits = [];
  const queue = [...replies];
  const globals = {
    AbortSignal: {
      timeout(ms) {
        deadlines.push(ms);
        return new AbortController().signal;
      },
    },
    setTimeout(fn, ms) {
      waits.push(ms);
      queueMicrotask(fn);
      return 1;
    },
    async fetch(input, init) {
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body,
        signal: init?.signal,
      });
      const reply = queue.shift();
      if (reply instanceof Error) throw reply;
      if (!reply) throw new Error('unexpected quota transport call');
      return reply;
    },
  };
  return { services: load('src/server/public-services.ts', globals), calls, deadlines, waits };
}

function expectPublicError(code, status) {
  return error => error?.code === code && error?.status === status;
}

test('normal quota admission uses one three-second RPC attempt', async () => {
  const h = harness([jsonResponse(true)]);
  await h.services.takeQuota('status:test', 180, 3600);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.deadlines, [3000]);
  assert.deepEqual(h.waits, []);
});

test('transient upstream 504 retries once with identical quota request', async () => {
  const h = harness([jsonResponse({ message: 'upstream timeout' }, 504), jsonResponse(true)]);
  await h.services.takeQuota('node-generation:test', 120, 3600);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.deadlines, [3000, 3000]);
  assert.deepEqual(h.waits, [100]);
  assert.equal(h.calls[0].url, h.calls[1].url);
  assert.equal(h.calls[0].method, h.calls[1].method);
  assert.equal(h.calls[0].body, h.calls[1].body);
  assert.deepEqual(JSON.parse(h.calls[0].body), {
    p_bucket: 'node-generation:test',
    p_limit: 120,
    p_seconds: 3600,
  });
});

test('network and timeout failures are the only thrown transport errors retried', async () => {
  for (const failure of [
    new TypeError('fetch failed'),
    Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    Object.assign(new Error('aborted'), { name: 'AbortError' }),
    failedBodyResponse(Object.assign(new Error('body timed out'), { name: 'TimeoutError' })),
  ]) {
    const h = harness([failure, jsonResponse(true)]);
    await h.services.takeQuota('status:test', 180, 3600);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.deadlines, [3000, 3000]);
  }
  const h = harness([new Error('programming failure'), jsonResponse(true)]);
  await assert.rejects(() => h.services.takeQuota('status:test', 180, 3600), expectPublicError('QUOTA_UNAVAILABLE', 503));
  assert.equal(h.calls.length, 1);
});

test('two transient failures stop at two attempts and fail closed', async () => {
  const h = harness([jsonResponse({ message: 'bad gateway' }, 502), jsonResponse({ message: 'unavailable' }, 503), jsonResponse(true)]);
  await assert.rejects(() => h.services.takeQuota('status:test', 180, 3600), expectPublicError('QUOTA_UNAVAILABLE', 503));
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.deadlines, [3000, 3000]);
  assert.deepEqual(h.waits, [100]);
});

test('valid false denial returns 429 without retry', async () => {
  const h = harness([jsonResponse(false), jsonResponse(true)]);
  await assert.rejects(() => h.services.takeQuota('status:test', 180, 3600), expectPublicError('RATE_LIMIT', 429));
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.waits, []);
});

test('unknown error-free quota payloads return 503 without retry', async () => {
  for (const response of [jsonResponse(null), jsonResponse({ admitted: true }), new Response(null, { status: 204 })]) {
    const h = harness([response, jsonResponse(true)]);
    await assert.rejects(() => h.services.takeQuota('status:test', 180, 3600), expectPublicError('QUOTA_UNAVAILABLE', 503));
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.waits, []);
  }
});

test('authentication, permission, and SQL validation errors fail closed without retry', async () => {
  for (const [status, code] of [[401, 'PGRST301'], [403, '42501'], [400, 'P0001']]) {
    const h = harness([jsonResponse({ code, message: 'rejected', details: null, hint: null }, status), jsonResponse(true)]);
    await assert.rejects(() => h.services.takeQuota('status:test', 180, 3600), expectPublicError('QUOTA_UNAVAILABLE', 503));
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.waits, []);
  }
});
