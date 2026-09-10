import { holderAccess } from './public-holder';
import { EMPTY_HOLDER_ACCESS, type ProStatus } from '../lib/pro-access';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { NextApiRequest } from 'next';
import { digest, fail, origin, readToken } from './public-security';

export function accountConfigured() { return Boolean(process.env.APP_ORIGIN && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY); }
export function emailSignInEnabled() { return process.env.EMAIL_SIGNIN_ENABLED === 'true'; }
export function billingConfigured() { return accountConfigured() && Boolean(process.env.STRIPE_SECRET_KEY && /^price_[A-Za-z0-9]+$/.test(process.env.STRIPE_PRO_PRICE_ID || '')); }
export function database() {
  origin();
  if (!accountConfigured()) fail(503, 'SETUP_REQUIRED', 'Account services are not configured yet.');
  const url = new URL(process.env.SUPABASE_URL!);
  if (url.protocol !== 'https:' || url.username || url.password) fail(503, 'SETUP_REQUIRED', 'Account services are not configured yet.');
  return createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) } });
}
export function authClient() { return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) } }); }
export function stripeClient() { if (!billingConfigured()) fail(503, 'BILLING_SETUP', 'Pro subscriptions are not on sale yet.'); return new Stripe(process.env.STRIPE_SECRET_KEY!, { timeout: 12000, maxNetworkRetries: 0 }); }
export async function takeQuota(bucket: string, limit: number, seconds: number) {
  const { data, error } = await database().rpc('hood_take_quota', { p_bucket: bucket, p_limit: limit, p_seconds: seconds });
  if (error) fail(503, 'QUOTA_UNAVAILABLE', 'Service unavailable. Please try again later.');
  if (data !== true) fail(429, 'RATE_LIMIT', 'Limit reached. Please try again later.');
}
export async function account(req: NextApiRequest, required = true): Promise<string | null> {
  const token = readToken(req);
  if (!token) { if (required) fail(401, 'SIGN_IN', 'Sign in to use Pro services.'); return null; }
  const { data, error } = await database().from('hood_sessions').select('user_id').eq('token_hash', digest(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) fail(503, 'AUTH_UNAVAILABLE', 'Account service unavailable.');
  if (!data?.user_id) { if (required) fail(401, 'SIGN_IN', 'Your session expired. Sign in again.'); return null; }
  return data.user_id as string;
}
export async function customerFor(userId: string, create = false): Promise<string | null> {
  const db = database(); const { data, error } = await db.from('hood_billing').select('customer_id').eq('user_id', userId).maybeSingle();
  if (error) fail(503, 'BILLING_UNAVAILABLE', 'Billing is unavailable.');
  if (data) return data.customer_id;
  if (!create) return null;
  const customer = await stripeClient().customers.create({ metadata: { hood_user_id: userId } }, { idempotencyKey: `hood-customer-${userId}` });
  const saved = await db.from('hood_billing').upsert({ user_id: userId, customer_id: customer.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (saved.error) fail(503, 'BILLING_UNAVAILABLE', 'Billing is unavailable.');
  return customerFor(userId, false);
}
const BILLING_ACCOUNT_TIMEOUT_MS = 8000;
export async function getBillingAccountStatus(userId: string, budgetMs = BILLING_ACCOUNT_TIMEOUT_MS): Promise<{ billingAccount: boolean; billingAccountUnavailable: boolean }> {
  // Navigation metadata must not consume the remaining client request deadline.
  const timeoutMs = Number.isFinite(budgetMs) ? Math.min(BILLING_ACCOUNT_TIMEOUT_MS, Math.max(0, budgetMs)) : 0;
  if (timeoutMs === 0) return { billingAccount: false, billingAccountUnavailable: true };
  return new Promise(resolve => {
    let finished = false;
    const finish = (value: { billingAccount: boolean; billingAccountUnavailable: boolean }) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      resolve(value);
    };
    const deadline = setTimeout(() => finish({ billingAccount: false, billingAccountUnavailable: true }), timeoutMs);
    Promise.resolve().then(() => customerFor(userId, false)).then(
      customer => finish({ billingAccount: Boolean(customer), billingAccountUnavailable: false }),
      () => finish({ billingAccount: false, billingAccountUnavailable: true }),
    );
  });
}
export function eligibleSubscription(subscription: Stripe.Subscription, customer: string, price: string) {
  return subscription.customer === customer && subscription.status === 'active' && subscription.items.data.some(item => item.price.id === price && item.quantity === 1 && item.current_period_end * 1000 > Date.now());
}
export async function hasSubscription(userId: string) {
  if (!billingConfigured()) return false;
  const customer = await customerFor(userId); if (!customer) return false;
  const subscriptions = await stripeClient().subscriptions.list({ customer, status: 'active', limit: 100 });
  return subscriptions.data.some(s => eligibleSubscription(s, customer, process.env.STRIPE_PRO_PRICE_ID!));
}
// Bound the combined read below the client request timeout. Transport operations retain
// their own deadlines; a slow provider must not delay another provider's verified grant.
const PRO_CHECK_TIMEOUT_MS = 8000;
export async function getProStatus(userId:string,sessionHash:string):Promise<ProStatus> {
  return new Promise(resolve => {
    let finished = false, subscriptionDone = false, holderDone = false;
    const status: ProStatus = {
      pro: false, subscription: false, subscriptionUnavailable: true,
      holder: { ...EMPTY_HOLDER_ACCESS, unavailable: true },
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      // Late provider responses cannot change authority or flags already returned.
      resolve({ ...status, holder: { ...status.holder } });
    };
    const complete = () => {
      status.pro = status.subscription || status.holder.eligible || status.holder.granted;
      if (status.pro || (subscriptionDone && holderDone)) finish();
    };
    const deadline = setTimeout(finish, PRO_CHECK_TIMEOUT_MS);
    // Install both rejection handlers immediately, including for synchronous setup
    // failures. Pending/failed providers remain unavailable, never eligible.
    Promise.resolve().then(() => hasSubscription(userId)).then(value => {
      if (finished) return;
      status.subscription = value;
      status.subscriptionUnavailable = false;
      subscriptionDone = true;
      complete();
    }, () => {
      if (finished) return;
      subscriptionDone = true;
      complete();
    });
    Promise.resolve().then(() => holderAccess(database(),userId,sessionHash)).then(value => {
      if (finished) return;
      status.holder = value;
      holderDone = true;
      complete();
    }, () => {
      if (finished) return;
      holderDone = true;
      complete();
    });
  });
}
export async function hasPro(userId:string,sessionHash:string):Promise<boolean> {
  const status=await getProStatus(userId,sessionHash);
  if(!status.pro && (status.subscriptionUnavailable || status.holder.unavailable))fail(503,'PRO_UNAVAILABLE','Unable to verify Pro access. Please try again later.');
  return status.pro;
}
export async function requirePro(req: NextApiRequest) {
  const id = (await account(req))!;
  await takeQuota(`pro-check:${id}`, 120, 3600);
  const token=readToken(req);if(!token)fail(401,'SIGN_IN','Sign in to use Pro services.');
  if (!(await hasPro(id,digest(token)))) fail(403, 'PRO_REQUIRED', 'An active subscription, verified wallet grant or qualifying HOODRICH holding is required.');
  return id;
}
