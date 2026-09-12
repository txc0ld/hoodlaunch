const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const actual = createRequire(filename);
  const req = name => Object.hasOwn(mocks, name)
    ? mocks[name]
    : name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(filename), name + '.ts'))
      ? load(path.resolve(path.dirname(filename), name + '.ts'), mocks, globals)
      : actual(name);
  vm.runInNewContext(source, {
    module, exports: module.exports, require: req, process, Buffer, URL, FormData, Blob,
    fetch, AbortSignal, setTimeout, clearTimeout, console, ...globals,
  }, { filename });
  return module.exports;
}

const security = load('src/server/public-security.ts');
const originalOrigin = process.env.APP_ORIGIN;
const originalJwt = process.env.PINATA_JWT;
process.env.APP_ORIGIN = 'https://launch.example.com';
process.env.PINATA_JWT = 'test-provider-token';
test.after(() => {
  if (originalOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = originalOrigin;
  if (originalJwt === undefined) delete process.env.PINATA_JWT; else process.env.PINATA_JWT = originalJwt;
});

function requestBytes(bytes, mime = 'image/png', extra = {}) {
  const req = new PassThrough();
  req.method = 'POST';
  req.rawHeaders = ['Origin', 'https://launch.example.com'];
  req.headers = { origin: 'https://launch.example.com', 'content-type': mime, ...extra };
  process.nextTick(() => req.end(bytes));
  return req;
}

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; },
  };
}

function route(services, upload) {
  return load('pages/api/token-image.ts', {
    '../../src/server/public-services': services,
    '../../src/server/public-security': security,
    '../../src/server/public-upload': upload,
    './public-services': services,
    './public-security': security,
  }).default;
}

function uploadStub(calls = []) {
  return {
    IMAGE_LIMIT: 4 * 1024 * 1024,
    sanitizeImage: async bytes => { calls.push('decode'); return bytes; },
    uploadPublicImage: async () => {
      calls.push('provider');
      return { uri: 'ipfs://QmYwAPJzv5CZsnAzt8auVZRnGiRA1PzKYw2JRUSpxD6aTv' };
    },
  };
}

function validCookie(token = 'a'.repeat(64)) {
  return `${security.cookieName()}=${token}`;
}

test('a signed-in Free account can upload within the five-attempt daily budget', async () => {
  const calls = [];
  const token = 'a'.repeat(64);
  const services = {
    account: async () => '11111111-1111-1111-1111-111111111111',
    getProStatus: async (userId, sessionHash) => {
      assert.equal(userId, '11111111-1111-1111-1111-111111111111');
      assert.equal(sessionHash, security.digest(token));
      return { pro: false };
    },
    takeQuota: async (bucket, limit, seconds) => calls.push({ bucket, limit, seconds }),
  };
  const handler = route(services, uploadStub());
  const req = requestBytes(Buffer.from('image'), 'image/png', {
    cookie: validCookie(token),
    'x-user-id': 'attacker-selected-user',
    'x-pro': 'true',
  });
  const res = response();

  await handler(req, res);

  assert.equal(res.code, 200);
  assert.deepEqual(calls.map(call => [call.bucket, call.limit, call.seconds]), [
    ['pro-check:11111111-1111-1111-1111-111111111111', 120, 3600],
    ['upload:11111111-1111-1111-1111-111111111111', 5, 86400],
    ['upload-burst-global', 30, 60],
    ['upload-global', 1000, 86400],
  ]);
});

test('verified server Pro receives fifty attempts while unavailable entitlement falls back to Free', async () => {
  for (const scenario of [
    { name: 'pro', status: async () => ({ pro: true }), limit: 50 },
    { name: 'unavailable', status: async () => { throw new Error('provider secret'); }, limit: 5 },
  ]) {
    const calls = [];
    const services = {
      account: async () => '22222222-2222-2222-2222-222222222222',
      getProStatus: scenario.status,
      takeQuota: async (bucket, limit, seconds) => calls.push({ bucket, limit, seconds }),
    };
    const res = response();
    await route(services, uploadStub())(
      requestBytes(Buffer.from('image'), 'image/jpeg', { cookie: validCookie('b'.repeat(64)) }),
      res,
    );
    assert.equal(res.code, 200, scenario.name);
    assert.equal(calls.find(call => call.bucket.startsWith('upload:')).limit, scenario.limit, scenario.name);
  }
});

test('guest, expired-session and cross-origin requests fail before entitlement, decoder or provider work', async () => {
  for (const scenario of [
    { name: 'guest', cookie: undefined, error: [401, 'SIGN_IN'] },
    { name: 'expired', cookie: validCookie('c'.repeat(64)), error: [401, 'SIGN_IN'] },
  ]) {
    const calls = [];
    const services = {
      account: async () => { calls.push('account'); security.fail(...scenario.error, 'Sign in.'); },
      getProStatus: async () => { calls.push('entitlement'); return { pro: true }; },
      takeQuota: async () => calls.push('quota'),
    };
    const res = response();
    await route(services, uploadStub(calls))(
      requestBytes(Buffer.from('image'), 'image/png', { cookie: scenario.cookie }),
      res,
    );
    assert.equal(res.code, 401, scenario.name);
    assert.deepEqual(calls, ['account'], scenario.name);
  }

  const calls = [];
  const services = {
    account: async () => { calls.push('account'); return 'user'; },
    getProStatus: async () => ({ pro: true }),
    takeQuota: async () => calls.push('quota'),
  };
  const req = requestBytes(Buffer.from('image'), 'image/png', { cookie: validCookie() });
  req.headers.origin = 'https://evil.example';
  const res = response();
  await route(services, uploadStub(calls))(req, res);
  assert.equal(res.code, 403);
  assert.deepEqual(calls, []);
});

test('strict MIME and provider setup checks do not consume upload admission', async () => {
  const quotaCalls = [];
  const downstream = [];
  const services = {
    account: async () => '33333333-3333-3333-3333-333333333333',
    getProStatus: async () => ({ pro: false }),
    takeQuota: async (...args) => quotaCalls.push(args),
  };
  for (const mime of ['image/svg+xml', 'image/png; charset=binary', 'application/octet-stream']) {
    const res = response();
    await route(services, uploadStub(downstream))(
      requestBytes(Buffer.from('<svg/>'), mime, { cookie: validCookie() }),
      res,
    );
    assert.equal(res.code, 415, mime);
  }
  assert.equal(quotaCalls.filter(([bucket]) => bucket.startsWith('upload:')).length, 0);
  assert.deepEqual(downstream, []);

  const jwt = process.env.PINATA_JWT;
  delete process.env.PINATA_JWT;
  try {
    const res = response();
    await route(services, uploadStub(downstream))(
      requestBytes(Buffer.from('image'), 'image/png', { cookie: validCookie() }),
      res,
    );
    assert.equal(res.code, 503);
    assert.equal(res.body.code, 'UPLOAD_SETUP');
    assert.equal(quotaCalls.filter(([bucket]) => bucket.startsWith('upload:')).length, 0);
  } finally {
    process.env.PINATA_JWT = jwt;
  }
});

test('body-size failure occurs after all admission slots and before decoder/provider work', async () => {
  const calls = [];
  const services = {
    account: async () => '44444444-4444-4444-4444-444444444444',
    getProStatus: async () => ({ pro: false }),
    takeQuota: async bucket => calls.push(bucket),
  };
  const res = response();
  await route(services, uploadStub(calls))(
    requestBytes(Buffer.from('ignored'), 'image/png', { cookie: validCookie(), 'content-length': String(4 * 1024 * 1024 + 1) }),
    res,
  );
  assert.equal(res.code, 413);
  assert.deepEqual(calls, [
    'pro-check:44444444-4444-4444-4444-444444444444',
    'upload:44444444-4444-4444-4444-444444444444',
    'upload-burst-global',
    'upload-global',
  ]);
});

async function quotaDb() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);');
  await db.exec(fs.readFileSync('db/001_public_services.sql', 'utf8'));
  await db.exec('set role service_role');
  return db;
}

function durableTakeQuota(db) {
  return async (bucket, limit, seconds) => {
    const result = await db.query(
      'select public.hood_take_quota($1,$2,$3) as admitted',
      [bucket, limit, seconds],
    );
    if (result.rows[0].admitted !== true) security.fail(429, 'RATE_LIMIT', 'Limit reached. Please try again later.');
  };
}

test('concurrent Free admission atomically reuses the existing account bucket and denies downstream work', async () => {
  const db = await quotaDb();
  try {
    const userId = '55555555-5555-5555-5555-555555555555';
    await db.query(
      "insert into public.hood_quota(bucket,used,expires_at) values($1,4,now()+interval '1 day')",
      [`upload:${userId}`],
    );
    const downstream = [];
    const services = {
      account: async () => userId,
      getProStatus: async () => ({ pro: false }),
      takeQuota: durableTakeQuota(db),
    };
    const handler = route(services, uploadStub(downstream));
    const responses = await Promise.all(Array.from({ length: 10 }, async () => {
      const res = response();
      await handler(requestBytes(Buffer.from('image'), 'image/png', { cookie: validCookie() }), res);
      return res;
    }));
    assert.equal(responses.filter(res => res.code === 200).length, 1);
    assert.equal(responses.filter(res => res.code === 429).length, 9);
    assert.equal(downstream.filter(call => call === 'decode').length, 1);
    assert.equal(downstream.filter(call => call === 'provider').length, 1);
    const stored = await db.query("select bucket,used from public.hood_quota where bucket like 'upload%' order by bucket");
    assert.deepEqual(stored.rows.map(row => [row.bucket, row.used]), [
      ['upload-burst-global', 1],
      ['upload-global', 1],
      [`upload:${userId}`, 5],
    ]);
  } finally {
    await db.close();
  }
});

test('global burst denial is atomic and never reaches daily-global, decoder or provider work', async () => {
  const db = await quotaDb();
  try {
    await db.query(
      "insert into public.hood_quota(bucket,used,expires_at) values('upload-burst-global',29,now()+interval '1 minute')",
    );
    const downstream = [];
    const services = {
      account: async req => req.headers['x-user'],
      getProStatus: async () => ({ pro: false }),
      takeQuota: durableTakeQuota(db),
    };
    const handler = route(services, uploadStub(downstream));
    const responses = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      const res = response();
      await handler(requestBytes(Buffer.from('image'), 'image/png', {
        cookie: validCookie(),
        'x-user': `burst-user-${index}`,
      }), res);
      return res;
    }));
    assert.equal(responses.filter(res => res.code === 200).length, 1);
    assert.equal(responses.filter(res => res.code === 429).length, 4);
    assert.equal(downstream.filter(call => call === 'decode').length, 1);
    assert.equal(downstream.filter(call => call === 'provider').length, 1);
    const globals = await db.query("select bucket,used from public.hood_quota where bucket in ('upload-burst-global','upload-global') order by bucket");
    assert.deepEqual(globals.rows.map(row => [row.bucket, row.used]), [
      ['upload-burst-global', 30],
      ['upload-global', 1],
    ]);
    const accounts = await db.query("select count(*)::integer as count,sum(used)::integer as used from public.hood_quota where bucket like 'upload:burst-user-%'");
    assert.deepEqual(accounts.rows[0], { count: 5, used: 5 });
  } finally {
    await db.close();
  }
});

function expectPublicError(code, status) {
  return error => error && error.code === code && error.status === status;
}

test('real decoder enforces magic, still-image, pixel, input and normalized-output bounds', async () => {
  const sharp = require('sharp');
  const upload = load('src/server/public-upload.ts', { './public-security': security });
  const red = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
  const animated = await sharp([red, blue], { join: { animated: true } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();

  await assert.rejects(upload.sanitizeImage(Buffer.from('<svg onload="alert(1)"/>'), 'image/png'), expectPublicError('IMAGE', 415));
  await assert.rejects(upload.sanitizeImage(red, 'image/jpeg'), expectPublicError('IMAGE', 415));
  await assert.rejects(upload.sanitizeImage(animated, 'image/webp'), expectPublicError('IMAGE', 415));
  await assert.rejects(upload.sanitizeImage(Buffer.alloc(4 * 1024 * 1024 + 1), 'image/png'), expectPublicError('IMAGE', 415));

  const tooManyPixels = await sharp({ create: { width: 4001, height: 4001, channels: 3, background: 'black' } }).png().toBuffer();
  await assert.rejects(upload.sanitizeImage(tooManyPixels, 'image/png'), expectPublicError('IMAGE', 415));

  const noisyAlpha = Buffer.alloc(1024 * 1024 * 4, 127);
  let state = 0x12345678;
  for (let pixel = 0; pixel < 1024 * 1024; pixel += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    noisyAlpha[pixel * 4 + 3] = state >>> 24;
  }
  const compressibleInput = await sharp(noisyAlpha, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
  assert.ok(compressibleInput.length < upload.IMAGE_LIMIT);
  await assert.rejects(upload.sanitizeImage(compressibleInput, 'image/png'), expectPublicError('IMAGE_OUTPUT', 413));
});

test('normalization produces metadata-free WebP at WebP85 within 1024px and one MiB', async () => {
  const sharp = require('sharp');
  const upload = load('src/server/public-upload.ts', { './public-security': security });
  const source = await sharp({ create: { width: 1400, height: 700, channels: 3, background: '#ccff66' } }).jpeg().withMetadata().toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  const output = await upload.sanitizeImage(source, 'image/jpeg');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.ok(output.length <= upload.NORMALIZED_IMAGE_LIMIT);
});

function providerResponse(chunks, options = {}) {
  let index = 0;
  let canceled = false;
  return {
    ok: options.ok !== false,
    body: options.noBody ? undefined : {
      getReader: () => ({
        async read() {
          if (options.readError) throw new Error('provider response secret');
          if (index >= chunks.length) return { done: true };
          return { done: false, value: chunks[index++] };
        },
        async cancel() { canceled = true; },
      }),
    },
    wasCanceled: () => canceled,
  };
}

test('provider upload uses only the fixed Pinata host, bounded output and server JWT', async () => {
  const cid = 'QmYwAPJzv5CZsnAzt8auVZRnGiRA1PzKYw2JRUSpxD6aTv';
  const reply = providerResponse([Buffer.from(JSON.stringify({ data: { cid } }))]);
  let call;
  const fetchMock = async (url, init) => { call = { url, init }; return reply; };
  const upload = load('src/server/public-upload.ts', { './public-security': security }, { fetch: fetchMock });
  const result = await upload.uploadPublicImage(Buffer.from('normalized-webp'));
  assert.equal(result.uri, `ipfs://${cid}`);
  assert.equal(result.cid, cid);
  assert.equal(call.url, 'https://uploads.pinata.cloud/v3/files');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.headers.Authorization, 'Bearer test-provider-token');
  assert.equal(call.init.body.get('network'), 'public');
  assert.equal(call.init.body.get('file').type, 'image/webp');
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(result).includes('test-provider-token'), false);
  await assert.rejects(
    upload.uploadPublicImage(Buffer.alloc(upload.NORMALIZED_IMAGE_LIMIT + 1)),
    expectPublicError('IMAGE_OUTPUT', 413),
  );
});

test('provider failures, malformed data and oversized responses fail once with bounded public errors', async () => {
  const cases = [
    { name: 'HTTP failure', response: providerResponse([], { ok: false }), code: 'UPLOAD_FAILED' },
    { name: 'missing body', response: providerResponse([], { noBody: true }), code: 'UPLOAD_FAILED' },
    { name: 'malformed JSON', response: providerResponse([Buffer.from('{')]), code: 'UPLOAD_FAILED' },
    { name: 'null JSON', response: providerResponse([Buffer.from('null')]), code: 'UPLOAD_FAILED' },
    { name: 'invalid CID', response: providerResponse([Buffer.from('{"data":{"cid":"not-a-cid"}}')]), code: 'UPLOAD_FAILED' },
    { name: 'oversized response', response: providerResponse([Buffer.alloc(32769)]), code: 'UPLOAD_FAILED', canceled: true },
    { name: 'reader failure', response: providerResponse([], { readError: true }), code: 'UPLOAD_FAILED' },
  ];
  for (const scenario of cases) {
    let calls = 0;
    const upload = load('src/server/public-upload.ts', { './public-security': security }, {
      fetch: async () => { calls += 1; return scenario.response; },
    });
    await assert.rejects(upload.uploadPublicImage(Buffer.from('normalized-webp')), expectPublicError(scenario.code, 502), scenario.name);
    assert.equal(calls, 1, scenario.name);
    if (scenario.canceled) assert.equal(scenario.response.wasCanceled(), true, scenario.name);
  }

  let calls = 0;
  const upload = load('src/server/public-upload.ts', { './public-security': security }, {
    fetch: async () => { calls += 1; throw new Error('provider JWT secret'); },
  });
  await assert.rejects(upload.uploadPublicImage(Buffer.from('normalized-webp')), expectPublicError('UPLOAD_FAILED', 502));
  assert.equal(calls, 1);
});
