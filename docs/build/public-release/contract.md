# HOODLABS public release contract

Base: 1938b724840e883cf362c725f5728e9d1bb633d4 (sanitized local snapshot; no owner history). Upstream local app remains untouched. Target GitHub txc0ld/hoodlaunch; Vercel tx-build/hoodlabs, separate from hood-rich. Target launch.hoodrich.rip; existing www.hoodrich.rip must remain live. Monetization: free launchpad plus paid Pro services; user-requested $6.90/month, currency pending; no live payment or chain execution in testing.

## Scope and ownership
Root owns integration, dependencies/lockfile, deployment configuration, CSP, source allowlist, reports. Critical owner owns audited launch verification/recovery, node session lifecycle and bridge reconciliation in isolated core checkout. Complex owner owns server account/billing/upload service and Pro account UI in isolated services checkout. One writer per checkout, no child delegation. Integrate patches only from approved allowed paths.

## Invariants (R3 core / R2 server)
- No private owner environment, journal, backup, history, API credential or signing key may enter public source/build/server. Public server has no exchange withdrawal/signing endpoint and never accepts wallet private keys.
- Generated wallet roots stay device-memory only; verified encrypted backup precedes signing. Manual lock and bounded idle authority revoke prebroadcast work; submitted evidence survives. Browser-origin compromise remains a disclosed custody limitation, not solved by module privacy.
- All native-value transfers preserve exact chain, recipient, calldata, fee/nonce limits and user intent; 2% node trade cap and no automatic resubmission remain. Verify trusted runtime before launch and bridge signing; canonical two-confirmation launch receipt before success/autopopulation. Persist validated nonsecret launch intent before wallet request and reconcile known hash safely after interruption.
- Authentication is verified server-side. Account IDs never come from client body/header claims. Supabase managed email OTP exchanges for revocable opaque one-hour sessions (only SHA256 token hashes stored) with HttpOnly Secure SameSite cookies; CSRF exact configured origin and method/content limits. No custom password storage.
- Pro entitlements come from verified Stripe subscription and fixed configured price, never redirect/localStorage. Each customer's billing mapping is server-owned and isolated. Missing auth/payment/upload config fails closed. Signed webhooks verify raw body and are replay/ordering safe. No charge or live checkout in tests.
- Free external-wallet launch works without account or upload API keys via validated existing image URI; managed raster upload requires authenticated Pro and durable quotas. No user credential collection. Public IPFS upload is explicitly public.
- Supported Next 16/React 19, no client source maps, restrictive production script CSP, no analytics/third-party script tags, security headers, bounded server inputs and controlled external calls.

## Acceptance and release
Typecheck, focused deterministic core/service regressions, existing applicable suite, production build, production dependency audit, secret-value scan against local values without output/exfiltration, compiled-app journeys with mocks, independent behavioral verification and fresh Astra review bound to exact final candidate. Zero real fund movement. No public deployment claim without successful hosting evidence. Billing remains disabled until user configures business-owned credentials/price. Public financial enablement requires qualified human release decision; source preparation/push is authorized. Record residual risks and missing operational checks honestly.

Key Principle: monetize isolated services without taking custody of customer or owner funds.

## Recorded implementation decisions
The runtime has a fixed three-child thread limit: spawning the configured Sol High complex builder returned `agent thread limit reached`. Root owns server implementation in the integration checkout; independent Sol High verification and fresh Astra High review remain mandatory, no weaker gate substituted. Services checkout is unused. Sites scaffold was superseded by explicit user Vercel target and will not be published.
Stripe entitlement is checked live per privileged request (no event-derived privilege cache); signed webhook acknowledgements have no entitlement side effects, making duplicates/out-of-order replay harmless. Session tokens are server-generated 256-bit opaque values, hashed at rest, one-hour absolute expiry with server-side logout deletion. New Supabase project/migration required. Default LIVE_LAUNCH_ENABLED is false until qualified release decision. Vercel automatic Git deployments disabled in source until mapping and deployment checks pass.
