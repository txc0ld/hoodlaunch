import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const CANONICAL_ORIGIN = 'https://labs.hoodrich.rip';
const PUBLIC_FALLBACK_HOST = 'hoodlabs.vercel.app';

function canonicalRedirect(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const acceptsHtml = request.headers.get('accept')?.split(',').some(value => value.split(';')[0].trim().toLowerCase() === 'text/html');
  if (
    process.env.APP_ORIGIN !== CANONICAL_ORIGIN ||
    request.nextUrl.hostname !== PUBLIC_FALLBACK_HOST ||
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    request.headers.get('sec-fetch-dest') !== 'document' ||
    request.headers.get('sec-fetch-mode') !== 'navigate' ||
    !acceptsHtml ||
    path === '/api' || path.startsWith('/api/') || path === '/_next' || path.startsWith('/_next/') ||
    lastSegment.includes('.')
  ) return null;
  const target = new URL(CANONICAL_ORIGIN);
  target.pathname = path;
  target.search = request.nextUrl.search;
  const response = NextResponse.redirect(target, 307);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function proxy(request: NextRequest) {
  const redirect = canonicalRedirect(request);
  if (redirect) return redirect;
  const nonce = randomBytes(24).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const csp = ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data: https:", "font-src 'self'", `connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://ethereum.publicnode.com https://api.relay.link https://api.web3modal.org https://rpc.walletconnect.org https://relay.walletconnect.org wss://relay.walletconnect.org${dev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`, "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'", "worker-src 'self' blob:", ...(dev ? [] : ['upgrade-insecure-requests'])].join('; ');
  const headers = new Headers(request.headers); headers.set('x-nonce', nonce); headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } }); response.headers.set('Content-Security-Policy', csp); response.headers.set('Cache-Control', 'private, no-store'); return response;
}
export const config = { matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'] };
