import { performance } from 'node:perf_hooks';
import { holderChallenge, verifyHolder, unlinkHolder } from '../../src/server/public-holder';
import { EMPTY_PRO_ACCESS } from '../../src/lib/pro-access';
import { billingPortal, subscriptionCheckout } from '../../src/server/public-checkout';
import { account, accountConfigured, authClient, billingConfigured, customerFor, database, emailSignInEnabled, getBillingAccountStatus, getProStatus, hasSubscription, stripeClient, takeQuota } from '../../src/server/public-services';
import { digest, publicSessionIdentity, fail, jsonBody, origin, readToken, safeHandler, sessionCookie, sessionToken, writeGuard } from '../../src/server/public-security';

export const config = { api: { bodyParser: false }, maxDuration: 60 };
export default safeHandler(async (req, res) => {
  const startedAt = performance.now();
  writeGuard(req);
  const body = await jsonBody(req);
  const action = body.action;
  if (action === 'status') {
    if (!accountConfigured()) { res.json(EMPTY_PRO_ACCESS); return; }
    const id = await account(req, false);
    if (id) await takeQuota(`status:${id}`, 180, 3600);
    const token=readToken(req);
    const [status,billingAccount]=id && token?await Promise.all([getProStatus(id,digest(token)),getBillingAccountStatus(id, Math.max(0, 17000 - (performance.now() - startedAt)))]):[EMPTY_PRO_ACCESS,{billingAccount:false,billingAccountUnavailable:false}];
    res.json({...status, ...billingAccount, sessionIdentity: id && token ? publicSessionIdentity(token) : null, configured: true, signInAvailable: emailSignInEnabled(), signedIn: Boolean(id), billing: billingConfigured() }); return;
  }
  if (action === 'holder-challenge' || action === 'holder-verify' || action === 'holder-unlink') {
    const id=(await account(req))!,token=readToken(req);if(!token)fail(401,'SIGN_IN','Sign in to verify holder access.');
    await takeQuota(`${action}:${id}`,action==='holder-verify'?20:10,900);
    const db=database(),session=digest(token);
    if(action==='holder-challenge'){res.json(await holderChallenge(db,id,session,body.address));return;}
    if(action==='holder-verify'){await verifyHolder(db,id,session,body.challengeId,body.signature);res.json({verified:true});return;}
    await unlinkHolder(db,id,session);res.json({unlinked:true});return;
  }
  if (action === 'request-code' || action === 'verify-code') {
    if (!emailSignInEnabled()) fail(503, 'SIGN_IN_UNAVAILABLE', 'Email sign-in is temporarily unavailable. Free launch planning remains available.');
    database();
    if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) fail(400, 'EMAIL', 'Enter a valid email address.');
    const email = body.email.trim().toLowerCase();
    await takeQuota(`auth-global`, 1000, 3600);
    await takeQuota(`${action}:${digest(email)}`, action === 'request-code' ? 3 : 8, 900);
    const client = authClient();
    if (action === 'request-code') {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) fail(429, 'CODE_UNAVAILABLE', 'Unable to send a code right now. Please wait before trying again.');
      res.json({ sent: true }); return;
    }
    if (typeof body.code !== 'string' || !/^\d{6,8}$/.test(body.code)) fail(400, 'CODE', 'Enter the code from your email.');
    const { data, error } = await client.auth.verifyOtp({ email, token: body.code, type: 'email' });
    if (error || !data.user?.id || !data.session) fail(401, 'CODE', 'Code is invalid or expired.');
    // Supabase verifies the identity. Only our revocable opaque session reaches the browser.
    const token = sessionToken();
    const stored = await database().from('hood_sessions').insert({ token_hash: digest(token), user_id: data.user.id, expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (stored.error) fail(503, 'AUTH_UNAVAILABLE', 'Unable to start a session. Request a new code.');
    sessionCookie(res, token); res.json({ signedIn: true }); return;
  }
  if (action === 'logout') {
    const token = readToken(req);
    if (token) { const { error } = await database().from('hood_sessions').delete().eq('token_hash', digest(token)); if (error) fail(503, 'LOGOUT_UNAVAILABLE', 'Unable to sign out. Please retry.'); }
    sessionCookie(res, '', true); res.json({ signedIn: false }); return;
  }
  if (action === 'checkout' || action === 'portal') {
    if (action === 'checkout' && process.env.LIVE_LAUNCH_ENABLED !== 'true') fail(503, 'BILLING_SETUP', 'Pro subscriptions are not on sale while live tools are disabled.');
    const id = (await account(req))!;
    await takeQuota(`billing:${id}`, 10, 3600);
    const stripe = stripeClient();
    const customer = await customerFor(id, action === 'checkout');
    if (!customer) fail(400, 'NO_BILLING', 'No subscription account exists yet.');
    if (action === 'portal' || await hasSubscription(id)) {
      res.json({ url: await billingPortal(stripe, customer, origin()) }); return;
    }
    res.json({ url: await subscriptionCheckout(database(), stripe, id, customer, process.env.STRIPE_PRO_PRICE_ID!, origin()) }); return;
  }
  fail(400, 'ACTION', 'Unknown account action.');
});
