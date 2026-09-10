import { fail, readBody, safeHandler } from '../../src/server/public-security';
import { stripeClient } from '../../src/server/public-services';
export const config = { api: { bodyParser: false }, maxDuration: 30 };
export default safeHandler(async (req, res) => {
  if (req.method !== 'POST') fail(405, 'METHOD', 'Use POST.');
  if (!process.env.STRIPE_WEBHOOK_SECRET) fail(503, 'SETUP_REQUIRED', 'Webhook is not configured.');
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') fail(400, 'SIGNATURE', 'Invalid signature.');
  const raw = await readBody(req, 256 * 1024);
  try { stripeClient().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET, 300); }
  catch { fail(400, 'SIGNATURE', 'Invalid signature.'); }
  // Events cannot grant access. Every privileged call fetches current Stripe state.
  // Consequently duplicate, delayed, or reordered events cannot extend entitlement.
  res.json({ received: true });
});
