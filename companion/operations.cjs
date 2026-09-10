'use strict';
const {plan, hash, decimal, fail} = require('./model.cjs');
const FIVE_MINUTES = 300000;
function reviewId(value) { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('Expected a review identifier.'); return value; }
function markers(p, row) { return ['destination-' + hash(row.address), 'intent-' + hash(p.id + ':' + row.index)]; }
function unsubmitted(state, p, row) {
  for (const key of markers(p, row)) if (state.read(key) !== null) fail('This intent or destination already has a submission record. A changed plan, amount, API key or exchange does not permit a retry. Check recovery instructions.');
}
async function prepare(state, exchange, input, index, maximumDebitEth, now = Date.now) {
  const p = plan(input), row = p.nodes[index - 1];
  if (!Number.isSafeInteger(index) || !row) fail('Select one node index from this plan.');
  const maximum = decimal(maximumDebitEth, true);
  unsubmitted(state, p, row);
  const quote = await exchange.inspect(row);
  if (quote.available !== true || exchange.provider !== 'kraken') fail('This connector supports inspection only. Complete the withdrawal on the exchange website.');
  if (decimal(quote.maximumDebitEth, true) > maximum) fail('The withdrawal exceeds your maximum debit budget.');
  const createdAt = now();
  const review = {version: 1, provider: exchange.provider, account: exchange.account, plan: p, index, maximumDebitEth, quote, createdAt, expiresAt: createdAt + FIVE_MINUTES};
  const id = hash(review); state.write('review-' + id, review);
  return Object.freeze({id, ...review, confirmation: 'WITHDRAW ' + id});
}
function loadReview(state, id, exchange) {
  reviewId(id); const review = state.read('review-' + id);
  if (!review || review.version !== 1 || hash(review) !== id || review.provider !== exchange.provider || review.account !== exchange.account || !Number.isSafeInteger(review.createdAt) || review.expiresAt !== review.createdAt + FIVE_MINUTES) fail('Review is missing, changed or belongs to another exchange key.');
  const p = plan(review.plan), row = p.nodes[review.index - 1];
  if (!Number.isSafeInteger(review.index) || !row) fail('Review node is invalid.');
  decimal(review.maximumDebitEth, true);
  return {review, p, row};
}
async function execute(state, exchange, id, confirmation, {env = process.env, now = Date.now} = {}) {
  if (env.HOODLAUNCH_EXCHANGE_LIVE !== 'true') fail('Live exchange withdrawals are disabled. Financial release approval is required before enabling HOODLAUNCH_EXCHANGE_LIVE.');
  if (confirmation !== 'WITHDRAW ' + reviewId(id)) fail('Explicit confirmation must match the exact reviewed withdrawal.');
  const {review, p, row} = loadReview(state, id, exchange);
  function fresh() { const time = now(); if (time < review.createdAt || time >= review.expiresAt) fail('Review expired. No new withdrawal was submitted; preserve any submission records.'); }
  fresh(); unsubmitted(state, p, row);
  // Recheck address-book mapping, network, permissions, balance/limits, EOA and fees immediately before the POST.
  const quote = await exchange.inspect(row);
  const bound = ['provider', 'account', 'available', 'chainId', 'asset', 'address', 'method', 'withdrawalKey', 'requestEth', 'feeEth', 'netEth', 'maximumDebitEth'];
  if (quote.available !== true || bound.some(k => quote[k] !== review.quote[k])) fail('Withdrawal details or fee changed. Prepare a new review; nothing was submitted.');
  if (decimal(quote.maximumDebitEth, true) > decimal(review.maximumDebitEth, true)) fail('Maximum debit budget exceeded.');
  fresh(); unsubmitted(state, p, row);
  const record = {version: 1, reviewId: id, provider: exchange.provider, account: exchange.account, planId: p.id, index: row.index, address: row.address, amountEth: row.amountEth, feeEth: quote.feeEth, status: 'unknown', reason: 'Submission may have started. Do not retry.', createdAt: now()};
  const names = markers(p, row);
  // Destination first: any partial persisted intent blocks changed plan IDs too.
  // Both durable markers must succeed before any withdrawal POST can happen. Unknown is the pre-send state.
  for (const key of names) state.write(key, record);
  fresh();
  let attempted = false;
  try {
    const result = await exchange.withdraw(quote, () => { fresh(); attempted = true; });
    const accepted = {...record, status: 'accepted', refid: result.refid, reason: 'Kraken accepted the request; this is not on-chain settlement.'};
    for (const key of names) state.write(key, accepted);
    return accepted;
  } catch (error) {
    if (!attempted) throw error; // A final guard failure is known to precede the HTTP request. Markers remain.
    // Includes explicit exchange errors: conservatively preserve the pre-send uncertainty marker, never retry.
    return {...record, reason: 'Submission outcome is unknown or rejected. Check Kraken and preserve the journal; automatic retry is blocked.'};
  }
}
async function history(state, exchange, id) {
  const {p, row} = loadReview(state, id, exchange);
  const record = state.read(markers(p, row)[0]);
  if (!record || record.reviewId !== id || !record.refid) return {status: 'unknown', retryAllowed: false, reason: 'No known reference. Check the exchange account and contact support; absence from recent history cannot prove no withdrawal occurred.'};
  return exchange.history(record.refid); // Read-only evidence. Never removes intent/destination markers.
}
module.exports = {prepare, execute, history, FIVE_MINUTES};
