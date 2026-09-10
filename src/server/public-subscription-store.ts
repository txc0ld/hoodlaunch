import type Stripe from 'stripe';
import { fail } from './public-security';

type Db = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Begin = { ignored: boolean; processed: boolean; version: number };
type Projection = {
  subscription: string;
  customer: string;
  price: string;
  status: string;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  endedAt: number | null;
};
export type SubscriptionSyncResult = 'processed' | 'duplicate' | 'ignored';

const EVENT_ID = /^evt_[A-Za-z0-9]+$/;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;
const PRICE_ID = /^price_[A-Za-z0-9]+$/;
const MAX_ID = 255;
const MAX_UNIX_SECONDS = 253402300799;
const STATUSES = new Set(['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid']);
const TYPES = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'checkout.session.completed']);

export function isSubscriptionSyncEventType(value: string): boolean { return TYPES.has(value); }

function syncUnavailable(): never {
  return fail(503, 'SUBSCRIPTION_SYNC', 'Subscription records could not be synchronized. Stripe will retry.');
}
function badEvent(message: string): never {
  return fail(400, 'STRIPE_EVENT', message);
}
function exactId(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_ID || !pattern.test(value)) badEvent(`Invalid ${label}.`);
  return value;
}
function nullableTime(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_UNIX_SECONDS) syncUnavailable();
  return value as number;
}
function trigger(event: Stripe.Event): { eventId: string; type: string; subscription: string; customer: string } | null {
  if (!isSubscriptionSyncEventType(event.type)) return null;
  const eventId = exactId(event.id, EVENT_ID, 'event ID');
  const object = event.data?.object as unknown;
  if (!object || typeof object !== 'object' || Array.isArray(object)) badEvent('Invalid event object.');
  const record = object as Record<string, unknown>;
  if (event.type === 'checkout.session.completed' && record.mode !== 'subscription') badEvent('Checkout event is not subscription mode.');
  return {
    eventId,
    type: event.type,
    subscription: exactId(event.type === 'checkout.session.completed' ? record.subscription : record.id, SUBSCRIPTION_ID, 'subscription ID'),
    customer: exactId(record.customer, CUSTOMER_ID, 'customer ID'),
  };
}
async function retrieveCurrent(stripe: Stripe, subscription: string): Promise<Stripe.Subscription> {
  try { return await stripe.subscriptions.retrieve(subscription); }
  catch { return syncUnavailable(); }
}
function project(current: Stripe.Subscription, expectedSubscription: string, expectedCustomer: string, configuredPrice: string): Projection | null {
  if (current.id !== expectedSubscription) return syncUnavailable();
  if (typeof current.customer !== 'string' || current.customer !== expectedCustomer) return syncUnavailable();
  if (!current.items || !Array.isArray(current.items.data) || current.items.data.length < 1 || current.items.data.length > 100) return syncUnavailable();
  const matches = current.items.data.filter(item => item?.price?.id === configuredPrice);
  if (matches.length === 0) return null;
  if (matches.length !== 1 || current.items.data.length !== 1 || matches[0].quantity !== 1) return syncUnavailable();
  if (!STATUSES.has(current.status) || typeof current.cancel_at_period_end !== 'boolean') return syncUnavailable();
  const periodEnd = matches[0].current_period_end;
  if (!Number.isSafeInteger(periodEnd) || periodEnd < 1 || periodEnd > MAX_UNIX_SECONDS) return syncUnavailable();
  return {
    subscription: expectedSubscription,
    customer: expectedCustomer,
    price: configuredPrice,
    status: current.status,
    periodEnd,
    cancelAtPeriodEnd: current.cancel_at_period_end,
    canceledAt: nullableTime(current.canceled_at),
    endedAt: nullableTime(current.ended_at),
  };
}
async function begin(db: Db, value: { eventId: string; type: string; subscription: string; customer: string }): Promise<Begin> {
  const { data, error } = await db.rpc('hood_subscription_begin', {
    p_event: value.eventId, p_type: value.type, p_subscription: value.subscription, p_customer: value.customer,
  });
  if (error || !data || typeof data !== 'object') return syncUnavailable();
  const result = data as Record<string, unknown>;
  if (typeof result.ignored !== 'boolean' || typeof result.processed !== 'boolean' || !Number.isSafeInteger(result.version) || (result.version as number) < 0) return syncUnavailable();
  if (!result.ignored && (result.version as number) < 1) return syncUnavailable();
  return result as Begin;
}
async function complete(db: Db, value: { eventId: string }, version: number, projection: Projection): Promise<void> {
  const { data, error } = await db.rpc('hood_subscription_complete', {
    p_event: value.eventId,
    p_subscription: projection.subscription,
    p_customer: projection.customer,
    p_version: version,
    p_price: projection.price,
    p_status: projection.status,
    p_period_end: projection.periodEnd,
    p_cancel_at_period_end: projection.cancelAtPeriodEnd,
    p_canceled_at: projection.canceledAt,
    p_ended_at: projection.endedAt,
  });
  if (error || data !== true) syncUnavailable();
}

/** Synchronize an allowlisted current Stripe projection; this data never decides Pro access. */
export async function syncSubscriptionEvent(db: Db, stripe: Stripe, event: Stripe.Event, configuredPrice: string): Promise<SubscriptionSyncResult> {
  const value = trigger(event);
  if (!value) return 'ignored';
  exactId(configuredPrice, PRICE_ID, 'configured price');
  const initial = project(await retrieveCurrent(stripe, value.subscription), value.subscription, value.customer, configuredPrice);
  if (!initial) return 'ignored';
  const reservation = await begin(db, value);
  if (reservation.ignored) return 'ignored';
  if (reservation.processed) return 'duplicate';
  // Retrieve again after obtaining the monotonic version. A concurrent older worker
  // cannot commit after a newer begin, and this snapshot is newer than its own fence.
  const current = project(await retrieveCurrent(stripe, value.subscription), value.subscription, value.customer, configuredPrice);
  if (!current) syncUnavailable();
  await complete(db, value, reservation.version, current);
  return 'processed';
}
