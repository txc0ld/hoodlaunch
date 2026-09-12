# HOODLABS

Free PONS launching with an external wallet, signed-in image uploads, and a subscription-or-HOODRICH-holder Pro workspace for up to 50 generated wallets. Target: **labs.hoodrich.rip**. Keep **www.hoodrich.rip** and its existing Vercel application intact.

## Run

Use Node 24. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, then `npm start`. The initial deployment is a **non-signing preview**: `LIVE_LAUNCH_ENABLED` defaults to false. Account services and checkout remain unavailable until configured. No mock payment, fake entitlement or owner credentials are bundled.

## Configure a separate launchpad deployment

1. Import **txc0ld/hoodlaunch** into a separate Vercel project. Do not reconnect or replace the live `hood-rich` project's repository: that could replace the main website. Set Node 24 and the Next.js framework.
2. Add **labs.hoodrich.rip** to that project and follow the DNS record Vercel actually provides. Do not guess DNS records or alter the existing root/www records.
3. Git auto-deployment is initially disabled by `vercel.json`. Use a reviewed preview deployment first; enable the chosen release branch only after validation and protection settings are confirmed.
4. Free image configuration accepts an existing validated image URI without an account. Managed upload is available to signed-in accounts: 5 attempts/user/day for Free, 50 for Pro, and 1,000 global attempts/day. Inputs are still PNG/JPEG/WebP up to 4MB and 16MP; normalized output is WebP, at most 1024px and 1MiB. IPFS files are public and can remain available permanently.
5. Create a **new business Supabase project**. Apply `db/001_public_services.sql` once, followed by `db/002_holder_pro.sql`. It is additive and must not run on the old operator app's data. Configure email OTP templates to display `{{ .Token }}` instead of relying on a magic-link callback. Use production SMTP, provider rate limits, signup abuse protection, and scheduled expired-session/quota cleanup as shown in the migration.
6. Set the server-only variables from `.env.example` in Vercel. Use the exact `APP_ORIGIN=https://labs.hoodrich.rip`. Use separate preview/test credentials and an exact preview origin for preview account testing. Never upload the operator `.env.local`, `.local/kraken`, seed phrases or wallet backups.
7. Use the **HOODLABS Pro** product (`prod_hoodlabs_pro`) in the verified Fantom Labs business account. Use the verified US$15 monthly price `price_1UE8NwBSWo9IPsgCbYePWgJb` (USD1500 cents, monthly). Set its fixed `STRIPE_PRO_PRICE_ID`, business-owned secret key, and set `STRIPE_PORTAL_CONFIGURATION_ID` to the dedicated HOODLABS portal. Test checkout/cancellation/refund/customer isolation in Stripe test mode first. There is no application fee added to PONS transactions. Protocol, bridge, exchange and gas fees are separate.
8. Optionally configure Stripe's signed `/api/stripe-webhook`; it acknowledges authentic events without granting privileges. Pro authorization independently checks an active exact-price Stripe subscription OR a current-session wallet proof holding at least 666,666 HOODRICH on chain4663. Privileged requests fetch fresh eligibility; delayed/duplicate webhook events cannot grant access. Trialing, past-due and expired subscriptions do not grant paid access. Either independently verified option suffices even if the other provider is unavailable.
9. Use a separate least-privilege business `PINATA_JWT` for managed uploads. The server never accepts customer API secrets and contains no Kraken/CEX withdrawal endpoint. Exchange withdrawals remain a separate local operator workflow/manual funding.
10. Follow `docs/HOSTING.md` and complete the release checks in `docs/SECURITY.md` and obtain the qualified financial release decision before setting `LIVE_LAUNCH_ENABLED=true`. This does not establish that the protocol or website is risk-free.

## Recovery and custody

Generated keys remain in browser memory, backed up in password-encrypted files. This is still browser custody: a compromised origin/device can compromise unlocked wallets. The vault's lock and idle expiry reduce unattended authority; they do not protect against malicious deployed code. Use dedicated browser profiles and limited working balances. Prefer an external hardware wallet for main holdings and free launches.

Pro is a hosted service entitlement, not DRM. The source is public; copied JavaScript can create wallets independently. Server-enforced Pro uploads and account services remain protected. A client button is not an authorization boundary.

Never delete pending operation history just to retry. Recovery records contain public transaction intent, not keys. Wallet backups do not coordinate concurrent devices or migrate local operation history. Keep the original browser until pending operations are resolved.

## Data handling

Supabase handles account email and stores server-only hashed opaque sessions, billing customer mapping, holder wallet links, short-lived challenges/current-session proofs and quota counters. Stripe handles card information and subscriptions. Sessions expire in one hour and sign-out deletes the matching server record. Wallet keys, passwords and exchange API secrets never belong in these services. No analytics scripts are included. RPC/Relay/IPFS providers can observe network requests and public wallet addresses.

The operator must configure contact/support details, jurisdiction-appropriate terms, privacy/retention/deletion processes and provider accounts before commercial release. No legal compliance or independent smart-contract audit is claimed.

## Holder access

The trusted HOODRICH contract is `0x6d5dc12131b2ad8748C54aB1Ac1b1a2cC53c2118` on Robinhood Chain4663, with18 decimals. The inclusive threshold is `666666000000000000000000` smallest units. One standard EOA wallet per account, unique across accounts; balances are not aggregated. Smart contract/delegated wallets are initially unsupported. Verification requests only an ownership message, never a transaction or approval.

Email authentication and a new proof in each one-hour session are required. Five-minute nonces are consumed atomically and bound to the account, current session, domain, address and chain. Unlink before replacing a wallet. Balance/code checks use a confirmed canonical block; RPC failures never grant holder access. An active subscription remains independent. The workspace refreshes about every minute and on focus; managed service requests check fresh state. Becoming a holder does not cancel or refund an existing subscription. Apply migration002 and complete live business-provider checks before advertising this service as available.
