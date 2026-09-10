'use strict';
const https = require('node:https');
const crypto = require('node:crypto');
const {fail} = require('./model.cjs');
const ORIGINS = Object.freeze({kraken: 'https://api.kraken.com', binance: 'https://api.binance.com', okx: 'https://www.okx.com', ethereum: 'https://ethereum-rpc.publicnode.com'});
const PATHS = Object.freeze({
  kraken: new Set(['GetApiKeyInfo', 'WithdrawMethods', 'WithdrawAddresses', 'WithdrawInfo', 'Withdraw', 'WithdrawStatus'].map(p => '/0/private/' + p)),
  binance: new Set(['/sapi/v1/account/apiRestrictions', '/sapi/v1/capital/config/getall', '/sapi/v1/capital/withdraw/address/list', '/sapi/v1/localentity/questionnaire-requirements']),
  okx: new Set(['/api/v5/account/config', '/api/v5/asset/currencies', '/api/v5/asset/balances']), ethereum: new Set(['/'])
});
function krakenSignature(path, nonce, body, secret) {
  return crypto.createHmac('sha512', Buffer.from(secret, 'base64')).update(Buffer.concat([Buffer.from(path), crypto.createHash('sha256').update(nonce + body).digest()])).digest('base64');
}
function hmac(secret, body, encoding = 'hex') { return crypto.createHmac('sha256', secret).update(body).digest(encoding); }
function requester(requestImpl = https.request, timeout = 15000) {
  return function request(provider, path, {method = 'GET', headers = {}, body = ''} = {}) {
    const origin = ORIGINS[provider];
    if (!origin || !PATHS[provider].has(path.split('?')[0]) || !path.startsWith('/') || path.includes('#') || path.includes('\\')) fail('Endpoint is not allowed.');
    if (provider !== 'kraken' && provider !== 'ethereum' && method !== 'GET') fail('This connector is read-only.');
    return new Promise((resolve, reject) => {
      let done = false; let req; const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); error ? reject(new Error(error)) : resolve(result); };
      const timer = setTimeout(() => { finish('Exchange request timed out. No request is retried.'); req?.destroy(); }, timeout);
      try {
        req = requestImpl(new URL(origin + path), {method, headers: {...headers, Accept: 'application/json', ...(body ? {'Content-Length': Buffer.byteLength(body)} : {})}}, response => {
          if (response.statusCode !== 200) { response.destroy(); finish('Exchange rejected the request or returned a redirect. Check the exchange directly; no retry was sent.'); return; }
          let bytes = 0; const chunks = [];
          response.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) { finish('Exchange response exceeded the size limit.'); response.destroy(); } else chunks.push(chunk); });
          response.on('error', () => finish('Exchange response was interrupted.'));
          response.on('end', () => { try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish('Exchange response was not valid JSON.'); } });
        });
        req.on('error', () => finish('Exchange request failed. No request is retried.'));
        req.end(body);
      } catch { finish('Exchange request could not be created.'); }
    });
  };
}
function credentials(provider, env = process.env) {
  const prefix = provider.toUpperCase();
  if (!['KRAKEN', 'BINANCE', 'OKX'].includes(prefix)) fail('Choose kraken, binance or okx.');
  const result = {key: env[prefix + '_API_KEY'], secret: env[prefix + '_API_SECRET'], ...(provider === 'okx' ? {passphrase: env.OKX_API_PASSPHRASE} : {})};
  if (Object.values(result).some(v => typeof v !== 'string' || !v.length || v.length > 1024 || /[\r\n]/.test(v))) fail(`Set ${prefix} credentials in this local process environment only.`);
  if (provider === 'kraken' && (!/^[A-Za-z0-9+/]+={0,2}$/.test(result.secret) || Buffer.from(result.secret, 'base64').length < 32)) fail('Kraken API secret must be valid base64.');
  return result;
}
module.exports = {requester, credentials, krakenSignature, hmac, ORIGINS};
