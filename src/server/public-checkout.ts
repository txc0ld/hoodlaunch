import type Stripe from 'stripe';
import { fail } from './public-security';

type Db = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Request = Stripe.Checkout.SessionCreateParams & { customer: string; client_reference_id: string; expires_at: number };
type Reservation = { key: string; expires_at: number; request: Request; session_id: string | null };
const MIN_REMAINING_SECONDS = 31 * 60;
function reconcile(): never { return fail(409, 'CHECKOUT_RECONCILE', 'Your previous checkout needs reconciliation. Open billing or contact support; a second checkout was not created.'); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
function reservation(value: unknown, expected: Stripe.Checkout.SessionCreateParams): Reservation {
  const r = value as Reservation;
  if (!r || typeof r.key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.key) || !Number.isSafeInteger(r.expires_at) || r.expires_at < 1 || !r.request || r.request.expires_at !== r.expires_at || (r.session_id !== null && (typeof r.session_id !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(r.session_id)))) reconcile();
  const { expires_at: _expiry, ...rest } = r.request;
  if (stable(rest) !== stable(expected)) reconcile();
  return r;
}
function hostedUrl(value: unknown, host: string): string {
  if (typeof value !== 'string') reconcile();
  let url: URL; try { url = new URL(value); } catch { return reconcile(); }
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port) reconcile();
  return value;
}
function portalConfiguration(): string {
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  if (!configuration || !/^bpc_[A-Za-z0-9]+$/.test(configuration)) fail(503, 'BILLING_SETUP', 'Billing portal configuration is unavailable.');
  return configuration;
}
export async function billingPortal(stripe: Stripe, customer: string, appOrigin: string): Promise<string> {
  const configuration = portalConfiguration();
  const portal = await stripe.billingPortal.sessions.create({ customer, return_url: appOrigin + '/', configuration });
  return hostedUrl(portal.url, 'billing.stripe.com');
}
function validateSession(session: Stripe.Checkout.Session, r: Reservation): void {
  const lines = session.line_items;
  if (!/^cs_[A-Za-z0-9_]+$/.test(session.id) || (r.session_id && session.id !== r.session_id) || session.customer !== r.request.customer || session.mode !== 'subscription' || session.client_reference_id !== r.request.client_reference_id || session.expires_at !== r.expires_at || session.success_url !== r.request.success_url || session.cancel_url !== r.request.cancel_url ||
      !lines || lines.has_more || lines.data.length !== 1 || lines.data[0].quantity !== 1 || lines.data[0].price?.id !== r.request.line_items![0].price || !['open', 'complete', 'expired'].includes(session.status || '')) reconcile();
}
export async function subscriptionCheckout(db: Db, stripe: Stripe, user: string, customer: string, price: string, appOrigin: string, now: () => number = Date.now): Promise<string> {
  portalConfiguration(); // A payable checkout must have a configured subscription-management path.
  if (!/^price_[A-Za-z0-9]+$/.test(price) || !/^cus_[A-Za-z0-9]+$/.test(customer)) reconcile();
  const request: Stripe.Checkout.SessionCreateParams = { mode: 'subscription', customer, client_reference_id: user, line_items: [{ price, quantity: 1 }], subscription_data: { metadata: { hood_user_id: user } }, success_url: appOrigin + '/?billing=return', cancel_url: appOrigin + '/?billing=cancelled', allow_promotion_codes: false };
  async function reserve(previous?: Reservation) {
    const { data, error } = await db.rpc('hood_checkout_reserve', { p_user: user, p_request: request, p_expected_key: previous?.key || null, p_expired_session: previous?.session_id || null });
    if (error) reconcile();
    return reservation(data, request);
  }
  let r = await reserve();
  for (let attempt = 0; attempt < 2; attempt++) {
    let session: Stripe.Checkout.Session;
    if (r.session_id) session = await stripe.checkout.sessions.retrieve(r.session_id, { expand: ['line_items.data.price'] });
    else {
      // Fixed DB deadline, not a fresh expiry on retry. No create can escape Stripe's idempotency retention by age.
      const seconds = Math.ceil(now() / 1000);
      if (!Number.isSafeInteger(seconds) || r.expires_at - seconds < MIN_REMAINING_SECONDS || r.expires_at - seconds > 23 * 60 * 60 + 60) reconcile();
      const created = await stripe.checkout.sessions.create(r.request, { idempotencyKey: `hood-checkout-${r.key}` });
      if (!created || typeof created.id !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(created.id)) reconcile();
      const { data, error } = await db.rpc('hood_checkout_bind', { p_user: user, p_key: r.key, p_session: created.id });
      if (error || data !== true) reconcile();
      r = { ...r, session_id: created.id };
      // Retrieve authoritative current state even when Stripe returned an idempotently cached create response.
      session = await stripe.checkout.sessions.retrieve(created.id, { expand: ['line_items.data.price'] });
    }
    validateSession(session, r);
    if (session.status === 'complete') return billingPortal(stripe, customer, appOrigin);
    if (session.status === 'open') {
      if (session.expires_at <= Math.floor(now() / 1000)) reconcile();
      return hostedUrl(session.url, 'checkout.stripe.com');
    }
    // Only an authenticated Stripe response proving this exact session expired permits CAS rotation.
    if (attempt === 1) reconcile();
    r = await reserve(r);
  }
  return reconcile();
}
