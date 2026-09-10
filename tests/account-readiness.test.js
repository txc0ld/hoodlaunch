const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const actual = createRequire(filename);
  const req = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const local = name.startsWith('.') ? path.resolve(path.dirname(filename), name) : '';
    if (local && fs.existsSync(local + '.ts')) return load(local + '.ts', mocks);
    return actual(name);
  };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: req,
    process,
    Buffer,
    URL,
    FormData,
    Blob,
    fetch,
    AbortSignal,
    setTimeout: globals.setTimeout || setTimeout,
    clearTimeout: globals.clearTimeout || clearTimeout,
    console,
  }, { filename });
  return module.exports;
}

const security = load('src/server/public-security.ts');
const previousOrigin = process.env.APP_ORIGIN;
process.env.APP_ORIGIN = 'https://launch.example.com';
test.after(() => {
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousOrigin;
});

function request(body = {}, headers = {}) {
  const req = new PassThrough();
  req.method = 'POST';
  req.rawHeaders = ['Origin', 'https://launch.example.com'];
  req.headers = {
    origin: 'https://launch.example.com',
    'content-type': 'application/json',
    ...headers,
  };
  process.nextTick(() => req.end(Buffer.from(JSON.stringify(body))));
  return req;
}

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; },
  };
}

const holder = { address: null, verified: false, eligible: false, granted: false, balance: null, unavailable: false };
const baseStatus = { pro: false, subscription: false, subscriptionUnavailable: false, holder };
const baseServices = {
  accountConfigured: () => true,
  emailSignInEnabled: () => false,
  billingConfigured: () => false,
  account: async () => null,
  getProStatus: async () => baseStatus,
  getBillingAccountStatus: async () => ({ billingAccount: false, billingAccountUnavailable: false }),
  takeQuota: async () => {},
};

function accountRoute(services = {}, checkout = {}, clock = require('node:perf_hooks').performance) {
  return load('pages/api/account.ts', {
    'node:perf_hooks': { performance: clock },
    '../../src/server/public-services': { ...baseServices, ...services },
    './public-services': { ...baseServices, ...services },
    '../../src/server/public-security': security,
    '../../src/server/public-checkout': {
      billingPortal: async () => 'https://billing.stripe.com/session/test',
      subscriptionCheckout: async () => 'https://checkout.stripe.com/session/test',
      ...checkout,
    },
  }).default;
}

test('email readiness accepts only the exact server value true', () => {
  const previous = process.env.EMAIL_SIGNIN_ENABLED;
  const services = load('src/server/public-services.ts', { './public-security': security });
  try {
    for (const value of [undefined, '', 'false', 'TRUE', '1', ' true ', 'yes']) {
      if (value === undefined) delete process.env.EMAIL_SIGNIN_ENABLED;
      else process.env.EMAIL_SIGNIN_ENABLED = value;
      assert.equal(services.emailSignInEnabled(), false, String(value));
    }
    process.env.EMAIL_SIGNIN_ENABLED = 'true';
    assert.equal(services.emailSignInEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.EMAIL_SIGNIN_ENABLED;
    else process.env.EMAIL_SIGNIN_ENABLED = previous;
  }
});

test('disabled request-code and verify-code stop before database, quota, auth, or cookies', async () => {
  for (const action of ['request-code', 'verify-code']) {
    const calls = { database: 0, quota: 0, auth: 0 };
    const route = accountRoute({
      emailSignInEnabled: () => false,
      database: () => {
        calls.database++;
        return { from: () => ({ insert: async () => ({ error: null }) }) };
      },
      takeQuota: async () => { calls.quota++; },
      authClient: () => {
        calls.auth++;
        return {
          auth: {
            signInWithOtp: async () => ({ error: null }),
            verifyOtp: async () => ({ data: { user: { id: 'user-1' }, session: {} }, error: null }),
          },
        };
      },
    });
    const res = response();
    await route(request({ action, email: 'person@example.com', code: '123456', signInAvailable: true }), res);
    assert.equal(res.code, 503, action);
    assert.equal(res.body.code, 'SIGN_IN_UNAVAILABLE', action);
    assert.deepEqual(calls, { database: 0, quota: 0, auth: 0 }, action);
    assert.equal(res.headers['Set-Cookie'], undefined, action);
  }
});

test('status readiness cannot be forged and existing sessions remain available', async () => {
  let res = response();
  await accountRoute({ emailSignInEnabled: () => false })(request({ action: 'status', signInAvailable: true }), res);
  assert.equal(res.body.signInAvailable, false);
  assert.equal(res.body.signedIn, false);

  res = response();
  await accountRoute({ emailSignInEnabled: () => true })(request({ action: 'status', signInAvailable: false }), res);
  assert.equal(res.body.signInAvailable, true);

  res = response();
  await accountRoute({
    emailSignInEnabled: () => false,
    account: async () => 'existing-user',
    getProStatus: async () => ({ ...baseStatus, pro: true, subscription: true }),
  })(request({ action: 'status' }, { cookie: `${security.cookieName()}=${'a'.repeat(64)}` }), res);
  assert.equal(res.body.signInAvailable, false);
  assert.equal(res.body.signedIn, true);
  assert.equal(res.body.pro, true);
});

test('enabled OTP paths retain provider verification and opaque session creation', async () => {
  const calls = { quota: 0, send: 0, verify: 0, insert: 0 };
  const route = accountRoute({
    emailSignInEnabled: () => true,
    database: () => ({
      rpc: async (name,args) => {
        assert.equal(name,'hood_auth_attempt');
        if(args.p_action==='begin')return {data:{started:true}};
        assert.equal(args.p_action,'finish');calls.insert++;
        assert.equal(args.p_payload.userId,'user-1');assert.match(args.p_payload.sessionHash,/^[a-f0-9]{64}$/);
        return {data:{signedIn:true}};
      },
    }),
    takeQuota: async () => { calls.quota++; },
    authClient: () => ({
      auth: {
        signInWithOtp: async ({ email }) => { calls.send++; assert.equal(email, 'person@example.com'); return { error: null }; },
        verifyOtp: async ({ email, token, type }) => {
          calls.verify++;
          assert.deepEqual({ email, token, type }, { email: 'person@example.com', token: '123456', type: 'email' });
          return { data: { user: { id: 'user-1' }, session: {} }, error: null };
        },
      },
    }),
  });

  let res = response();
  await route(request({ action: 'request-code', email: 'Person@Example.com' }), res);
  assert.equal(res.body.sent, true);
  res = response();
  await route(request({ action: 'verify-code', email: 'Person@Example.com', code: '123456', requestId:'11111111-1111-4111-8111-111111111111',requestStartedAt:new Date().toISOString() },{cookie:'hood-auth-binding='+'a'.repeat(64)}), res);
  assert.equal(res.body.signedIn, true);
  assert.match(res.headers['Set-Cookie'], /^hood-session=[a-f0-9]{64};/);
  assert.deepEqual(calls, { quota: 5, send: 1, verify: 1, insert: 1 });
});

test('disabled email readiness does not block logout or an existing billing portal', async () => {
  let deleted = false;
  let res = response();
  await accountRoute({
    emailSignInEnabled: () => false,
    database: () => ({ rpc: async (name,args) => { assert.equal(name,'hood_auth_attempt');assert.equal(args.p_action,'logout');deleted=true;return {data:{canceled:true}}; } }),
  })(request({ action: 'logout' }, { cookie: `${security.cookieName()}=${'b'.repeat(64)}` }), res);
  assert.equal(deleted, true);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);

  res = response();
  await accountRoute({
    emailSignInEnabled: () => false,
    account: async () => 'existing-user',
    stripeClient: () => ({ marker: 'stripe' }),
    customerFor: async () => 'cus_existing',
  })(request({ action: 'portal' }, { cookie: `${security.cookieName()}=${'b'.repeat(64)}` }), res);
  assert.equal(res.body.url, 'https://billing.stripe.com/session/test');
});

function renderProAccess(access, salesEnabled = false) {
  const states = [access, '', '', false, false, ''];
  let stateIndex = 0;
  const react = {
    useCallback: fn => fn,
    useEffect: () => {},
    useRef: value => ({ current: value }),
    useState: initial => [stateIndex < states.length ? states[stateIndex++] : initial, () => {}],
  };
  const node = (type, props, key) => ({ type, props: props || {}, key });
  const css = new Proxy({}, { get: (_target, key) => String(key) });
  const empty = { configured: false, signInAvailable: false, signedIn: false, billing: false, billingAccount: false, billingAccountUnavailable: false, ...baseStatus };
  const component = load('src/components/ProAccess.tsx', {
    react,
    'react/jsx-runtime': { jsx: node, jsxs: node, Fragment: Symbol('Fragment') },
    './ProAccess.module.css': { __esModule: true, default: css },
    ethers: { utils: { formatUnits: value => String(value) } },
    '../lib/pro-access': {
      EMPTY_PRO_ACCESS: empty,
      HOODRICH_DECIMALS: 18,
      HOODRICH_MINIMUM_FORMATTED: '666,666',
      HOODRICH_TOKEN: '0x6d5dc12131b2ad8748C54aB1Ac1b1a2cC53c2118',
      PRO_PRICE_LABEL: 'US$15/month',
    },
    '../lib/holder-wallet': { verifyHolderWallet: async () => {} },
    '../lib/wallet-provider': {
      getWalletProvider: () => null,
      getWalletVersion: () => 0,
      subscribeWalletProvider: () => () => {},
    },
  }).default;
  return component({ onAccessChange: () => {}, salesEnabled });
}

function descendants(root) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if (value.type) found.push(value);
    visit(value.props?.children);
  }
  visit(root);
  return found;
}

function textContent(root) {
  let text = '';
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value === 'string' || typeof value === 'number') { text += String(value); return; }
    if (value && typeof value === 'object') visit(value.props?.children);
  }
  visit(root);
  return text;
}

test('ProAccess renders readiness transitions without hiding existing-session controls', () => {
  const available = { configured: true, signInAvailable: true, signedIn: false, billing: true, billingAccount: true, billingAccountUnavailable: false, ...baseStatus };
  const enabledTree = renderProAccess(available);
  assert.equal(descendants(enabledTree).filter(node => node.type === 'form').length, 1);
  assert.match(textContent(enabledTree), /Email me a code/);

  for (const signInAvailable of [false, undefined, 'true']) {
    const disabledTree = renderProAccess({ ...available, signInAvailable });
    assert.equal(descendants(disabledTree).filter(node => node.type === 'form').length, 0, String(signInAvailable));
    assert.match(textContent(disabledTree), /Email sign-in is temporarily unavailable/i, String(signInAvailable));
  }

  const signedInTree = renderProAccess({ ...available, signInAvailable: false, signedIn: true });
  const signedInText = textContent(signedInTree);
  assert.doesNotMatch(signedInText, /Email me a code/);
  assert.match(signedInText, /Sign out & lock wallets/);
  assert.match(signedInText, /Manage billing/);
});

test('billing-account metadata distinguishes existing, missing, and failed lookups without Stripe writes', async () => {
  const previous = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://inert.supabase.test',
    SUPABASE_ANON_KEY: 'inert-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'inert-service',
  });
  try {
    for (const [result, expected] of [
      [{ data: { customer_id: 'cus_existing' }, error: null }, { billingAccount: true, billingAccountUnavailable: false }],
      [{ data: null, error: null }, { billingAccount: false, billingAccountUnavailable: false }],
      [{ data: null, error: new Error('database unavailable') }, { billingAccount: false, billingAccountUnavailable: true }],
    ]) {
      let selects = 0;
      let stripeWrites = 0;
      const services = load('src/server/public-services.ts', {
        './public-security': security,
        './public-holder': { holderAccess: async () => holder },
        '@supabase/supabase-js': {
          createClient: () => ({
            from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { selects++; return result; } }) }) }),
          }),
        },
        stripe: class Stripe { constructor() { stripeWrites++; } },
      });
      const actual = await services.getBillingAccountStatus('existing-user');
      assert.equal(actual.billingAccount, expected.billingAccount);
      assert.equal(actual.billingAccountUnavailable, expected.billingAccountUnavailable);
      assert.equal(selects, 1);
      assert.equal(stripeWrites, 0);
    }
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('billing-account metadata times out as unknown within the Pro-check deadline', async () => {
  const previous = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://inert.supabase.test',
    SUPABASE_ANON_KEY: 'inert-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'inert-service',
  });
  let expire;
  let cleared = false;
  try {
    const services = load('src/server/public-services.ts', {
      './public-security': security,
      './public-holder': { holderAccess: async () => holder },
      '@supabase/supabase-js': {
        createClient: () => ({
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }),
        }),
      },
      stripe: class Stripe {},
    }, {
      setTimeout: (callback, milliseconds) => {
        assert.equal(milliseconds, 8000);
        expire = callback;
        return 42;
      },
      clearTimeout: timer => { assert.equal(timer, 42); cleared = true; },
    });
    const pending = services.getBillingAccountStatus('existing-user');
    await Promise.resolve();
    expire();
    const actual = await pending;
    assert.equal(actual.billingAccount, false);
    assert.equal(actual.billingAccountUnavailable, true);
    assert.equal(cleared, true);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('authenticated status starts Pro and billing metadata reads together and ignores client claims', async () => {
  let proStarted = false;
  let billingStarted = false;
  let releasePro;
  let releaseBilling;
  const route = accountRoute({
    account: async () => 'existing-user',
    getProStatus: async () => {
      proStarted = true;
      return new Promise(resolve => { releasePro = () => resolve({ ...baseStatus, pro: true, holder: { ...holder, granted: true } }); });
    },
    getBillingAccountStatus: async () => {
      billingStarted = true;
      return new Promise(resolve => { releaseBilling = () => resolve({ billingAccount: false, billingAccountUnavailable: true }); });
    },
  });
  const res = response();
  const pending = route(request({ action: 'status', billingAccount: true, billingAccountUnavailable: false }, { cookie: `${security.cookieName()}=${'c'.repeat(64)}` }), res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(proStarted, true);
  assert.equal(billingStarted, true);
  releasePro();
  releaseBilling();
  await pending;
  assert.equal(res.body.pro, true);
  assert.equal(res.body.billingAccount, false);
  assert.equal(res.body.billingAccountUnavailable, true);
});

function buttonLabels(tree) {
  return descendants(tree)
    .filter(node => node.type === 'button')
    .map(node => ({ label: textContent(node), disabled: node.props.disabled }));
}

test('billing navigation UI avoids dead ends while preserving valid portal and checkout paths', () => {
  const common = {
    configured: true,
    signInAvailable: false,
    signedIn: true,
    billing: true,
    billingAccount: false,
    billingAccountUnavailable: false,
    ...baseStatus,
  };
  const holderOnly = renderProAccess({ ...common, pro: true, holder: { ...holder, eligible: true } }, true);
  assert.equal(buttonLabels(holderOnly).some(button => button.label === 'Manage billing'), false);

  for (const billingAccount of [undefined, 'true']) {
    const malformed = renderProAccess({ ...common, pro: true, billingAccount, holder: { ...holder, granted: true } }, true);
    assert.equal(buttonLabels(malformed).some(button => button.label === 'Manage billing'), false, String(billingAccount));
  }

  const priorCustomer = renderProAccess({ ...common, pro: true, billingAccount: true, subscriptionUnavailable: true, holder: { ...holder, granted: true } }, true);
  assert.equal(buttonLabels(priorCustomer).some(button => button.label === 'Manage billing' && button.disabled === false), true);

  const firstTime = renderProAccess(common, true);
  assert.equal(buttonLabels(firstTime).some(button => button.label === 'See Pro price & subscribe' && button.disabled === false), true);

  const paid = renderProAccess({ ...common, pro: true, subscription: true, billingAccount: true });
  assert.equal(buttonLabels(paid).some(button => button.label === 'Manage subscription'), true);

  const unknown = renderProAccess({ ...common, pro: true, billingAccountUnavailable: true, holder: { ...holder, eligible: true } }, true);
  assert.equal(buttonLabels(unknown).some(button => button.label === 'Manage billing'), false);
  assert.match(textContent(unknown), /Billing account status is temporarily unavailable/i);
});

test('portal still refuses an authenticated account without a Stripe customer', async () => {
  let portalCalls = 0;
  const res = response();
  await accountRoute({
    account: async () => 'existing-user',
    stripeClient: () => ({}),
    customerFor: async (_id, create) => { assert.equal(create, false); return null; },
  }, {
    billingPortal: async () => { portalCalls++; return 'https://billing.stripe.com/session/should-not-run'; },
  })(request({ action: 'portal' }, { cookie: `${security.cookieName()}=${'d'.repeat(64)}` }), res);
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'NO_BILLING');
  assert.equal(portalCalls, 0);
});


test('optional billing metadata uses remaining route time without changing verified Pro', async () => {
  for (const [elapsed, expected] of [[13000, 4000], [17000, 0], [22000, 0]]) {
    let now = 100;
    let observedBudget;
    const route = accountRoute({
      account: async () => { now += 7000; return 'existing-user'; },
      takeQuota: async () => { now += elapsed - 7000; },
      getProStatus: async () => ({ ...baseStatus, pro: true, holder: { ...holder, granted: true } }),
      getBillingAccountStatus: async (_id, budget) => {
        observedBudget = budget;
        return { billingAccount: false, billingAccountUnavailable: true };
      },
    }, {}, { now: () => now });
    const res = response();
    await route(request({ action: 'status' }, { cookie: `${security.cookieName()}=${'e'.repeat(64)}` }), res);
    assert.equal(observedBudget, expected);
    assert.equal(res.body.pro, true);
    assert.equal(res.body.holder.granted, true);
    assert.equal(res.body.billingAccountUnavailable, true);
  }
});

test('billing metadata caps optional budgets and skips lookup when time is exhausted or invalid', async () => {
  for (const budget of [0, -1, NaN, Infinity, -Infinity]) {
    let operations = 0;
    const services = load('src/server/public-services.ts', {
      '@supabase/supabase-js': { createClient: () => { operations++; throw new Error('unexpected lookup'); } },
    }, { setTimeout: () => { operations++; throw new Error('unexpected timer'); } });
    const result = await services.getBillingAccountStatus('existing-user', budget);
    assert.equal(result.billingAccountUnavailable, true);
    assert.equal(result.billingAccount, false);
    assert.equal(operations, 0);
  }
  for (const [budget, expected] of [[4000, 4000], [50000, 8000]]) {
    let expire;
    const services = load('src/server/public-services.ts', {}, {
      setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, expected); expire = callback; return 42; },
      clearTimeout: () => {},
    });
    const pending = services.getBillingAccountStatus('existing-user', budget);
    expire();
    assert.equal((await pending).billingAccountUnavailable, true);
  }
});


test('account status exposes only a session display fence for authenticated cookies', async () => {
 const token = 'd'.repeat(64);
 const signed = response();
 await accountRoute({ account: async () => 'verified-account' })(request({ action: 'status' }, { cookie: `${security.cookieName()}=${token}` }), signed);
 assert.equal(signed.body.sessionIdentity, security.publicSessionIdentity(token));
 assert.match(signed.body.sessionIdentity, /^[a-f0-9]{64}$/);
 assert.notEqual(signed.body.sessionIdentity, token);
 assert.notEqual(signed.body.sessionIdentity, security.digest(token));
 const anonymous = response();
 await accountRoute()(request({ action: 'status', sessionIdentity: signed.body.sessionIdentity }, { cookie: `${security.cookieName()}=${token}` }), anonymous);
 assert.equal(anonymous.body.sessionIdentity, null);
 assert.equal(anonymous.body.signedIn, false);
});
