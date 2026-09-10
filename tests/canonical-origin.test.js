const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');

function loadProxy() {
  const filename = path.resolve('proxy.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const actual = createRequire(filename);
  const nextResponse = {
    next: options => ({ kind: 'next', options, headers: new Headers() }),
    redirect: (url, status) => ({ kind: 'redirect', status, location: String(url), headers: new Headers() }),
  };
  const req = name => name === 'next/server' ? { NextResponse: nextResponse } : actual(name);
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: req,
    process,
    URL,
    Headers,
    console,
  }, { filename });
  return module.exports.proxy;
}

function request({
  method = 'GET',
  hostname = 'hoodlabs.vercel.app',
  pathname = '/',
  search = '',
  accept = 'text/html,application/xhtml+xml',
  destination = 'document',
  headers = {},
} = {}) {
  return {
    method,
    nextUrl: { hostname, pathname, search },
    headers: new Headers({
      accept,
      'sec-fetch-dest': destination,
      'sec-fetch-mode': 'navigate',
      ...headers,
    }),
  };
}

const previousOrigin = process.env.APP_ORIGIN;
const previousNodeEnv = process.env.NODE_ENV;
test.beforeEach(() => {
  process.env.APP_ORIGIN = 'https://labs.hoodrich.rip';
  process.env.NODE_ENV = 'production';
});
test.after(() => {
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousOrigin;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

test('fallback GET and HEAD document navigations redirect temporarily to the canonical origin', () => {
  const proxy = loadProxy();
  for (const method of ['GET', 'HEAD']) {
    const response = proxy(request({ method, pathname: '/guide', search: '?tab=wallets%20and%20nodes' }));
    assert.equal(response.kind, 'redirect');
    assert.equal(response.status, 307);
    assert.equal(response.location, 'https://labs.hoodrich.rip/guide?tab=wallets%20and%20nodes');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('redirect construction preserves path/query without allowing a protocol-relative host escape', () => {
  const response = loadProxy()(request({ pathname: '//evil.example/escape', search: '?next=https%3A%2F%2Fevil.example' }));
  assert.equal(response.kind, 'redirect');
  const target = new URL(response.location);
  assert.equal(target.origin, 'https://labs.hoodrich.rip');
  assert.equal(target.pathname, '//evil.example/escape');
  assert.equal(target.search, '?next=https%3A%2F%2Fevil.example');
});

test('canonical, preview, local, and foreign hosts continue without a redirect', () => {
  const proxy = loadProxy();
  for (const hostname of ['labs.hoodrich.rip', 'hoodlabs-git-main-team.vercel.app', 'localhost', '127.0.0.1', 'evil.example']) {
    const response = proxy(request({ hostname }));
    assert.equal(response.kind, 'next', hostname);
    assert.match(response.headers.get('Content-Security-Policy'), /script-src/);
  }
});

test('API, static, non-HTML, non-document, and mutating requests never redirect', () => {
  const proxy = loadProxy();
  const cases = [
    { pathname: '/api/account' },
    { pathname: '/_next/static/chunk.js', accept: 'text/html' },
    { pathname: '/images/hoodlabs.webp', accept: 'image/avif,image/webp', destination: 'image' },
    { pathname: '/guide', accept: 'application/json' },
    { pathname: '/guide', destination: 'empty' },
    { pathname: '/guide', method: 'POST' },
  ];
  for (const input of cases) assert.equal(proxy(request(input)).kind, 'next', JSON.stringify(input));
});

test('HTML excluded by its quality weight or malformed weight is not a document redirect', () => {
  const proxy = loadProxy();
  for (const accept of [
    'text/html;q=0, application/json', 'text/html;q=0.0, */*;q=1',
    'text/html; Q = 0.000', 'text/html;q=invalid', 'text/html;q=1.1',
    'text/html;q=0.5;q=1',
  ]) assert.equal(proxy(request({ accept })).kind, 'next', accept);
  for (const accept of ['text/html', 'text/html;q=0.1, application/json', 'TEXT/HTML; Q=1.000']) {
    assert.equal(proxy(request({ accept })).kind, 'redirect', accept);
  }
});

test('missing, malformed, noncanonical, and nonexact APP_ORIGIN values disable redirect', () => {
  const proxy = loadProxy();
  for (const value of [undefined, '', 'not-a-url', 'http://labs.hoodrich.rip', 'https://labs.hoodrich.rip/', 'https://evil.example']) {
    if (value === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = value;
    assert.equal(proxy(request()).kind, 'next', String(value));
  }
});

test('forwarding headers cannot select or suppress the redirect host', () => {
  const proxy = loadProxy();
  let response = proxy(request({ headers: { 'x-forwarded-host': 'labs.hoodrich.rip', host: 'labs.hoodrich.rip' } }));
  assert.equal(response.kind, 'redirect');
  response = proxy(request({ hostname: 'labs.hoodrich.rip', headers: { 'x-forwarded-host': 'hoodlabs.vercel.app', host: 'hoodlabs.vercel.app' } }));
  assert.equal(response.kind, 'next');
});
