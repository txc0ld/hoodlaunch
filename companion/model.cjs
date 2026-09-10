'use strict';
const crypto = require('node:crypto');
const UNIT = 10n ** 18n;
function fail(message) { throw new Error(message); }
function decimal(value, positive = false) {
  if (typeof value !== 'string' || value.length > 80 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) fail('Expected an exact ETH decimal string (at most 18 decimal places).');
  const [whole, part = ''] = value.split('.');
  const wei = BigInt(whole) * UNIT + BigInt(part.padEnd(18, '0'));
  if (positive && wei === 0n) fail('Amount must be positive.');
  return wei;
}
function format(wei) { const fraction = (wei % UNIT).toString().padStart(18, '0').replace(/0+$/, ''); return `${wei / UNIT}${fraction ? '.' + fraction : ''}`; }
function address(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) fail('Expected a nonzero Ethereum address.');
  // Exported generated addresses are accepted case-insensitively; EOA status is checked on Ethereum before review.
  return value.toLowerCase();
}
function keys(object, allowed) { if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(k => !allowed.includes(k))) fail('Unexpected plan fields. Never include private keys or credentials in plans.'); }
function plan(input) {
  keys(input, ['version', 'id', 'sourceChainId', 'asset', 'createdAt', 'nodes']);
  if (input.version !== 1 || input.sourceChainId !== 1 || input.asset !== 'ETH') fail('Only native ETH on Ethereum mainnet (chain 1) is supported.');
  if (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) fail('Plan id must be a UUID.');
  if (typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt) fail('createdAt must be an ISO UTC timestamp.');
  if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > 50) fail('A plan must contain 1 to 50 nodes.');
  const seen = new Set();
  const nodes = input.nodes.map((row, i) => {
    keys(row, ['index', 'address', 'amountEth', 'withdrawalKey']);
    if (row.index !== i + 1) fail('Node indexes must be consecutive, starting at 1.');
    const a = address(row.address); if (seen.has(a)) fail('Duplicate destination address.'); seen.add(a);
    const amountEth = format(decimal(row.amountEth, true));
    if (row.withdrawalKey !== undefined && (typeof row.withdrawalKey !== 'string' || !row.withdrawalKey.length || row.withdrawalKey.length > 100 || /[\x00-\x1f\x7f]/.test(row.withdrawalKey))) fail('Invalid withdrawal address-book key.');
    return Object.freeze({index: row.index, address: a, amountEth, ...(row.withdrawalKey === undefined ? {} : {withdrawalKey: row.withdrawalKey})});
  });
  return Object.freeze({version: 1, id: input.id.toLowerCase(), sourceChainId: 1, asset: 'ETH', createdAt: input.createdAt, nodes: Object.freeze(nodes)});
}
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
module.exports = {fail, decimal, format, address, plan, hash};
