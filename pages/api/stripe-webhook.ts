import { fail, readBody, safeHandler } from '../../src/server/public-security';
import { database, stripeClient } from '../../src/server/public-services';
import { isSubscriptionSyncEventType, syncSubscriptionEvent } from '../../src/server/public-subscription-store';
export const config = { api: { bodyParser: false }, maxDuration: 30 };
export default safeHandler(async (req, res) => {
  if (req.method !== 'POST') fail(405, 'METHOD', 'Use POST.');
  if (!process.env.STRIPE_WEBHOOK_SECRET) fail(503, 'SETUP_REQUIRED', 'Webhook is not configured.');
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') fail(400, 'SIGNATURE', 'Invalid signature.');
  const raw = await readBody(req, 256 * 1024);
  const stripe = stripeClient();
  let event;
  try { event = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET, 300); }
  catch { fail(400, 'SIGNATURE', 'Invalid signature.'); }
  const secret = process.env.STRIPE_SECRET_KEY || '';
  const expectedLive = secret.startsWith('sk_live_') ? true : secret.startsWith('sk_test_') ? false : null;
  if (expectedLive === null) fail(503, 'BILLING_SETUP', 'Webhook billing mode is not configured.');
  if (event.livemode !== expectedLive) fail(400, 'STRIPE_MODE', 'Webhook mode does not match billing mode.');
  if (event.account !== undefined && event.account !== null) fail(400, 'STRIPE_ACCOUNT', 'Connected-account events are not accepted.');
  if (isSubscriptionSyncEventType(event.type)) await syncSubscriptionEvent(database(), stripe, event, process.env.STRIPE_PRO_PRICE_ID!);
  // Stored snapshots are operational records only. Privileged calls still fetch Stripe.
  res.json({ received: true });
});
