import { createHash, randomBytes } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export class PublicError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(status: number, code: string, message: string): never { throw new PublicError(status, code, message); }
export function origin() {
  const value = process.env.APP_ORIGIN || '';
  let url: URL;
  try { url = new URL(value); } catch { return fail(503, 'SETUP_REQUIRED', 'Account services are not configured yet. Free launching remains available.'); }
  if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost'))) {
    return fail(503, 'SETUP_REQUIRED', 'Account services are not configured yet.');
  }
  return value;
}
export function writeGuard(req: NextApiRequest) {
  if (req.method !== 'POST') fail(405, 'METHOD', 'Use POST.');
  const expected = origin();
  const count = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'origin').length;
  if (count !== 1 || req.headers.origin !== expected || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) fail(403, 'ORIGIN', 'Open this action from the launchpad website.');
}
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function sessionToken() { return randomBytes(32).toString('hex'); }
export function cookieName() { return process.env.NODE_ENV === 'production' ? '__Host-hood-session' : 'hood-session'; }
export function readToken(req: NextApiRequest) {
  const name = cookieName();
  const entries = (req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function sessionCookie(res: NextApiResponse, token: string, clear = false) {
  res.setHeader('Set-Cookie', `${cookieName()}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 3600}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
export async function readBody(req: NextApiRequest, limit = 8192): Promise<Buffer> {
  const length = req.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) fail(413, 'BODY_SIZE', 'Request is too large.');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const done = (error?: Error) => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', errorHandler); req.off('aborted', aborted); error ? reject(error) : resolve(Buffer.concat(chunks)); };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > limit) done(new PublicError(413, 'BODY_SIZE', 'Request is too large.')); else chunks.push(chunk); };
    const end = () => done(); const errorHandler = () => done(new PublicError(400, 'BODY', 'Unable to read request.')); const aborted = errorHandler;
    const timer = setTimeout(() => done(new PublicError(408, 'TIMEOUT', 'Request took too long.')), 10000);
    req.on('data', data); req.once('end', end); req.once('error', errorHandler); req.once('aborted', aborted);
  });
}
export async function jsonBody(req: NextApiRequest) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') fail(415, 'CONTENT_TYPE', 'Use JSON.');
  try { const body = JSON.parse((await readBody(req)).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'JSON', 'Invalid request.'); return body as Record<string, unknown>; }
  catch (error) { if (error instanceof PublicError) throw error; return fail(400, 'JSON', 'Invalid JSON.'); }
}
export function safeHandler(handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try { await handler(req, res); }
    catch (error) { const e = error instanceof PublicError ? error : new PublicError(503, 'SERVICE_UNAVAILABLE', 'Service unavailable. Please try again later.'); if (e.status === 405) res.setHeader('Allow', 'POST'); res.status(e.status).json({ error: e.message, code: e.code }); }
  };
}
