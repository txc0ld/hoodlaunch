import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const csp = ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data: https:", "font-src 'self'", `connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://ethereum.publicnode.com https://api.relay.link${dev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`, "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'", "worker-src 'self' blob:", ...(dev ? [] : ['upgrade-insecure-requests'])].join('; ');
  const headers = new Headers(request.headers); headers.set('x-nonce', nonce); headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } }); response.headers.set('Content-Security-Policy', csp); response.headers.set('Cache-Control', 'private, no-store'); return response;
}
export const config = { matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'] };
