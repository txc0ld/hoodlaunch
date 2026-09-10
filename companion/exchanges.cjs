'use strict';
const {decimal, format, address, hash, fail} = require('./model.cjs');
const {requester, credentials, krakenSignature, hmac} = require('./transport.cjs');
function list(value) { if (!Array.isArray(value) || value.length > 10000) fail('Exchange returned an unsupported list.'); return value; }
function exactlyOne(rows, message) { if (rows.length !== 1) fail(message); return rows[0]; }
function createExchange(provider, state, {env = process.env, request = requester(), now = Date.now} = {}) {
  const creds = credentials(provider, env), account = hash(provider + ':' + creds.key);
  // Nonces are persisted and each CLI command holds the one local process lock. No concurrent Kraken calls.
  async function call(path, params = {}) {
    let data;
    if (provider === 'kraken') {
      const nonce = state.nonce(account), body = new URLSearchParams({nonce, ...params}).toString();
      data = await request(provider, path, {method: 'POST', body, headers: {'Content-Type': 'application/x-www-form-urlencoded', 'API-Key': creds.key, 'API-Sign': krakenSignature(path, nonce, body, creds.secret)}});
      if (!data || !Array.isArray(data.error) || data.error.length || !Object.hasOwn(data, 'result')) fail('Kraken did not authorize this operation. Check permissions, address verification, holds, Travel Rule and API 2FA directly in Kraken.');
      return data.result;
    }
    if (provider === 'binance') {
      const query = new URLSearchParams({...params, recvWindow: '5000', timestamp: String(now())}).toString();
      data = await request(provider, path + '?' + query + '&signature=' + hmac(creds.secret, query), {headers: {'X-MBX-APIKEY': creds.key}});
      if (data && typeof data.code === 'number' && data.code < 0) fail('Binance did not authorize this read. Check account settings in Binance.');
      return data;
    }
    const query = new URLSearchParams(params).toString(), target = path + (query ? '?' + query : ''), stamp = new Date(now()).toISOString();
    data = await request(provider, target, {headers: {'OK-ACCESS-KEY': creds.key, 'OK-ACCESS-SIGN': hmac(creds.secret, stamp + 'GET' + target, 'base64'), 'OK-ACCESS-TIMESTAMP': stamp, 'OK-ACCESS-PASSPHRASE': creds.passphrase}});
    if (!data || data.code !== '0') fail('OKX did not authorize this read. Check account settings in OKX.');
    return data.data;
  }
  async function eoa(destination) {
    async function rpc(method, params) { const result = await request('ethereum', '/', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})}); if (result?.id !== 1 || result.error) fail('Ethereum RPC could not verify this destination.'); return result.result; }
    if (await rpc('eth_chainId', []) !== '0x1') fail('RPC is not Ethereum mainnet.');
    if (await rpc('eth_getCode', [destination, 'latest']) !== '0x') fail('Destination has code or could not be verified as an EOA on Ethereum.');
  }
  async function inspect(input) {
    const row = Object.freeze({index: input.index, address: address(input.address), amountEth: format(decimal(input.amountEth, true)), withdrawalKey: input.withdrawalKey});
    await eoa(row.address);
    const amount = decimal(row.amountEth, true);
    if (provider === 'kraken') {
      if (!row.withdrawalKey) fail('Add the exact verified Kraken address-book key as withdrawalKey for this row.');
      const info = await call('/0/private/GetApiKeyInfo');
      if (!Array.isArray(info?.permissions) || !['query-funds', 'withdraw-funds'].every(p => info.permissions.includes(p))) fail('Kraken key requires query-funds and withdraw-funds permissions.');
      const methods = list(await call('/0/private/WithdrawMethods', {asset: 'ETH', network: 'Ethereum'}));
      const method = exactlyOne(methods.filter(m => m && ['ETH', 'XETH'].includes(m.asset) && m.network === 'Ethereum' && typeof m.method === 'string' && m.method.length > 0 && m.method.length <= 100), 'No unique available native ETH withdrawal method on Ethereum.');
      const minimum = decimal(method.minimum, true);
      const destinations = list(await call('/0/private/WithdrawAddresses', {asset: 'ETH', method: method.method, key: row.withdrawalKey, verified: 'true'}));
      exactlyOne(destinations.filter(d => d && d.verified === true && ['ETH', 'XETH'].includes(d.asset) && d.method === method.method && d.key === row.withdrawalKey && typeof d.address === 'string' && d.address.toLowerCase() === row.address), 'Kraken address-book key is not a unique verified match for this address and Ethereum method.');
      const q = await call('/0/private/WithdrawInfo', {asset: 'ETH', key: row.withdrawalKey, amount: row.amountEth});
      if (!q || q.method !== method.method) fail('Kraken quote method changed.');
      const fee = decimal(q.fee), net = decimal(q.amount, true), limit = decimal(q.limit);
      // Kraken's documented legacy funding example: request 100, fee 4, recipient 96.
      // Require the response to prove that relationship, rather than infer unfamiliar fee semantics.
      if (net + fee !== amount) fail('Kraken fee/net semantics are inconsistent; withdrawal is blocked.');
      if (amount < minimum || net < minimum || amount > limit) fail('Amount is outside the currently available Kraken withdrawal bounds.');
      return Object.freeze({provider, account, available: true, chainId: 1, asset: 'ETH', address: row.address, method: method.method, withdrawalKey: row.withdrawalKey, requestEth: row.amountEth, feeEth: format(fee), netEth: format(net), maximumDebitEth: row.amountEth, minimumEth: format(minimum), limitEth: format(limit), feeSemantics: 'Kraken deducts the fee from the request amount. The quoted net is indicative; max_fee caps the fee at submission.'});
    }
    if (provider === 'binance') {
      const permissions = await call('/sapi/v1/account/apiRestrictions');
      if (permissions?.enableReading !== true) fail('Binance read permission is unavailable.');
      const coin = exactlyOne(list(await call('/sapi/v1/capital/config/getall')).filter(c => c?.coin === 'ETH'), 'Binance did not return native ETH.');
      const network = exactlyOne(list(coin.networkList).filter(n => n?.network === 'ETH' && n.coin === 'ETH' && n.contractAddress === ''), 'Binance did not return the native Ethereum network.');
      const fee = decimal(network.withdrawFee), minimum = decimal(network.withdrawMin), maximum = decimal(network.withdrawMax);
      const step = decimal(network.withdrawIntegerMultiple, true);
      const addresses = list(await call('/sapi/v1/capital/withdraw/address/list'));
      const whitelisted = addresses.filter(d => d?.coin === 'ETH' && d.network === 'ETH' && d.whiteStatus === true && typeof d.address === 'string' && d.address.toLowerCase() === row.address && !d.addressTag).length === 1;
      const travel = await call('/sapi/v1/localentity/questionnaire-requirements');
      return Object.freeze({provider, account, available: false, chainId: 1, asset: 'ETH', address: row.address, requestEth: row.amountEth, feeEth: format(fee), minimumEth: format(minimum), limitEth: format(maximum), readPermission: true, withdrawalPermission: permissions.enableWithdrawals === true, networkEnabled: coin.withdrawAllEnable === true && network.withdrawEnable === true && network.busy === false && network.withdrawTag === false, amountInBounds: amount >= minimum && amount <= maximum && amount % step === 0n, whitelisted, travelRuleClear: travel === 'NIL', reason: 'Read-only connection. No documented exchange-enforced fee ceiling; recipient net/debit semantics are not asserted. Complete withdrawal in Binance and satisfy its address and Travel Rule checks.'});
    }
    const config = exactlyOne(list(await call('/api/v5/account/config')), 'OKX returned ambiguous account configuration.');
    const permissions = typeof config.perm === 'string' ? config.perm.split(',') : [];
    if (!permissions.includes('read_only')) fail('OKX read permission is unavailable.');
    const currency = exactlyOne(list(await call('/api/v5/asset/currencies', {ccy: 'ETH'})).filter(c => c?.ccy === 'ETH' && c.chain === 'ETH-ERC20' && c.ctAddr === ''), 'OKX did not return native ETH on Ethereum.');
    const fee = decimal(currency.fee), minimum = decimal(currency.minWd), maximum = decimal(currency.maxWd);
    const balance = exactlyOne(list(await call('/api/v5/asset/balances', {ccy: 'ETH'})).filter(c => c?.ccy === 'ETH'), 'OKX did not return an ETH funding balance.');
    const available = decimal(balance.availBal);
    return Object.freeze({provider, account, available: false, chainId: 1, asset: 'ETH', address: row.address, requestEth: row.amountEth, feeEth: format(fee), minimumEth: format(minimum), limitEth: format(maximum), readPermission: true, withdrawalPermission: permissions.includes('withdraw'), networkEnabled: currency.canWd === true && currency.needTag === false, amountInBounds: amount >= minimum && amount <= maximum && available >= amount + fee, reason: 'Read-only connection. OKX adds the fee to the requested amount; there is no documented request fee ceiling or complete whitelist/Travel Rule readiness preflight. Complete withdrawal in OKX.'});
  }
  async function withdraw(review) {
    if (provider !== 'kraken') fail('Automated withdrawals are unavailable for this connector.');
    const result = await call('/0/private/Withdraw', {asset: 'ETH', key: review.withdrawalKey, address: review.address, amount: review.requestEth, max_fee: review.feeEth});
    if (!result || typeof result.refid !== 'string' || !/^[A-Za-z0-9-]{5,100}$/.test(result.refid)) fail('Kraken submission outcome is unknown. Check Kraken directly.');
    return {refid: result.refid};
  }
  async function history(refid) {
    if (provider !== 'kraken' || !/^[A-Za-z0-9-]{5,100}$/.test(refid)) fail('History requires a known Kraken reference.');
    const records = list(await call('/0/private/WithdrawStatus', {asset: 'ETH'}));
    const matches = records.filter(r => r?.refid === refid);
    if (matches.length !== 1) return {status: 'unknown', reason: 'No unique reference in the bounded recent history. Check Kraken directly; this does not permit a retry.'};
    const row = matches[0];
    return {refid, status: ['Initial', 'Pending', 'Settled', 'Success', 'Failure'].includes(row.status) ? row.status : 'unknown', ...(typeof row.txid === 'string' && /^0x[0-9a-fA-F]{64}$/.test(row.txid) ? {transactionHash: row.txid} : {}), retryAllowed: false};
  }
  return {provider, account, inspect, withdraw, history};
}
module.exports = {createExchange};
