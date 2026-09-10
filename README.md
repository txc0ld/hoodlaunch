# Hoodrich Launch

Free PONS launching with an external wallet, plus a paid Pro workspace for up to 50 generated wallets and managed image uploads. Target: **launch.hoodrich.rip**. Keep **www.hoodrich.rip** and its existing Vercel application intact.

## Run

Use Node 24. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, then `npm start`. The initial deployment is a **non-signing preview**: `LIVE_LAUNCH_ENABLED` defaults to false. Account services and checkout remain unavailable until configured. No mock payment, fake entitlement or owner credentials are bundled.

## Configure a separate launchpad deployment

1. Import **txc0ld/hoodlaunch** into a separate Vercel project. Do not reconnect or replace the live `hood-rich` project's repository: that could replace the main website. Set Node 24 and the Next.js framework.
2. Add **launch.hoodrich.rip** to that project and follow the DNS record Vercel actually provides. Do not guess DNS records or alter the existing root/www records.
3. Git auto-deployment is initially disabled by `vercel.json`. Use a reviewed preview deployment first; enable the chosen release branch only after validation and protection settings are confirmed.
4. Free image configuration accepts an existing validated image URI. Managed upload is a Pro service, limited to still PNG/JPEG/WebP, 4MB input, 16MP decode, 1024px output, 50 attempts/user/day, and 1,000 global attempts/day. IPFS files are public and can remain available permanently.
5. Create a **new business Supabase project**. Apply `db/001_public_services.sql` once. It is additive and must not run on the old operator app's data. Configure email OTP templates to display `{{ .Token }}` instead of relying on a magic-link callback. Use production SMTP, provider rate limits, signup abuse protection, and scheduled expired-session/quota cleanup as shown in the migration.
6. Set the server-only variables from `.env.example` in Vercel. Use the exact `APP_ORIGIN=https://launch.hoodrich.rip`. Use separate preview/test credentials and an exact preview origin for preview account testing. Never upload the operator `.env.local`, `.local/kraken`, seed phrases or wallet backups.
7. Create a Stripe recurring monthly **Pro** price after choosing the business price and terms. Set its fixed `STRIPE_PRO_PRICE_ID`, business-owned secret key, and configure Stripe Customer Portal. Test checkout/cancellation/refund/customer isolation in Stripe test mode first. There is no application fee added to PONS transactions. Protocol, bridge, exchange and gas fees are separate.
8. Optionally configure Stripe's signed `/api/stripe-webhook`; it acknowledges authentic events without granting privileges. Pro authorization fetches current Stripe subscription state on every privileged request, so delayed/duplicate webhook events cannot grant access. An active exact-price subscription is required; trialing, past-due and expired states are denied.
9. Use a separate least-privilege business `PINATA_JWT` for managed uploads. The server never accepts customer API secrets and contains no Kraken/CEX withdrawal endpoint. Exchange withdrawals remain a separate local operator workflow/manual funding.
10. Complete the release checks in `docs/SECURITY.md` and obtain the qualified financial release decision before setting `LIVE_LAUNCH_ENABLED=true`. This does not establish that the protocol or website is risk-free.

## Recovery and custody

Generated keys remain in browser memory, backed up in password-encrypted files. This is still browser custody: a compromised origin/device can compromise unlocked wallets. The vault's lock and idle expiry reduce unattended authority; they do not protect against malicious deployed code. Use dedicated browser profiles and limited working balances. Prefer an external hardware wallet for main holdings and free launches.

Pro is a hosted service entitlement, not DRM. The source is public; copied JavaScript can create wallets independently. Server-enforced paid uploads and account services remain protected. A client button is not an authorization boundary.

Never delete pending operation history just to retry. Recovery records contain public transaction intent, not keys. Wallet backups do not coordinate concurrent devices or migrate local operation history. Keep the original browser until pending operations are resolved.

## Data handling

Supabase handles account email and stores server-only hashed opaque sessions, billing customer mapping and quota counters. Stripe handles card information and subscriptions. Sessions expire in one hour and sign-out deletes the matching server record. Wallet keys, passwords and exchange API secrets never belong in these services. No analytics scripts are included. RPC/Relay/IPFS providers can observe network requests and public wallet addresses.

The operator must configure contact/support details, jurisdiction-appropriate terms, privacy/retention/deletion processes and provider accounts before commercial release. No legal compliance or independent smart-contract audit is claimed.
