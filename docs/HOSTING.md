# HOODLABS hosting and subscription setup

The public app is a separate source release. Do not deploy the original local operator folder or copy its `.env.local`, wallet backups, withdrawal journals or Git history.

| Resource | Intended target |
| --- | --- |
| GitHub | `txc0ld/hoodlaunch` |
| Vercel team / project | `tx-build` / `hoodlabs` |
| Public address | `https://labs.hoodrich.rip` |
| Existing website | Leave `www.hoodrich.rip` and Vercel `hood-rich` intact |
| Stripe business account | Fantom Labs, `acct_1TFnGyBSWo9IPsgC` |
| Stripe product | `prod_hoodlabs_pro`, HOODLABS Pro |

The subscription is US$15 per month. Use only the active USD 1500-minor-unit monthly licensed per-unit price for `prod_hoodlabs_pro`; the server reads these authoritative terms before it can reserve or create a payable Checkout session. Do not use an unrelated price or create a customer subscription manually. Customers subscribe through their own authenticated HOODLABS Checkout session.

## Server configuration

Set these in the **new** Vercel project's environment settings. Never prefix credentials with `NEXT_PUBLIC_`, commit them, or paste them into support chat.

| Variable | Meaning |
| --- | --- |
| `APP_ORIGIN` | Exact deployed HTTPS origin, without a trailing slash. Preview account calls must use that preview's explicitly configured origin. |
| `LIVE_LAUNCH_ENABLED` | Defaults to `false`. Both signing tools and new paid Checkout sessions remain disabled until the financial release decision and operational checks are complete. |
| `SUPABASE_URL` | URL of a new business Supabase project. |
| `SUPABASE_ANON_KEY` | Key for that project's email-code identity flow. It is used only on the server in this implementation. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access for revocable sessions, billing mapping and quotas. |
| `EMAIL_SIGNIN_ENABLED` | Server-only email entry gate. Only exact `true` enables request/verify; keep `false` until actual inbox delivery, verification, expiry/replay and logout/re-sign-in pass. Existing sessions, portal access and signed webhook synchronization remain independent. |
| `PRO_WALLET_ALLOWLIST` | Optional server-only list of at most 100 comma-separated exact nonzero EVM addresses. A match grants Pro only after the existing current-session holder proof and chain checks succeed. |
| `STRIPE_SECRET_KEY` | Business Stripe API key, from the same account and mode as the Pro price. Never use the operator's exchange or wallet keys. |
| `STRIPE_PRO_PRICE_ID` | Verified active `prod_hoodlabs_pro` recurring price: USD, 1500 minor units, monthly interval count 1, licensed per-unit billing. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated HOODLABS billing portal configuration; live catalog ID `bpc_1UDxZCBSWo9IPsgCDQGAA4YZ`. Use a separate test configuration for test-mode checks. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this deployment's Stripe webhook endpoint. |
| `PINATA_JWT` | New business-scoped upload credential; do not copy the owner's existing personal token. |

Use separate test and live provider configuration. Run `db/001_public_services.sql`, then `db/002_holder_pro.sql`, then independently reviewed `db/003_subscription_store.sql`, once against the new Supabase project after verifying its target. Migration002 adds service-only holder links, challenges and current-session proofs. Migration003 adds service-only current Stripe subscription snapshots and an idempotent event receipt ledger; those snapshots never authorize Pro. Enable email OTP with a code-bearing template, configured SMTP and appropriate provider send limits. Schedule the expired session/quota cleanup described in the migration. Test anonymous/authenticated roles cannot read service tables or execute their RPCs.

Current protected-release status: the dedicated Supabase service tables and Stripe webhook secret are configured according to release-coordinator operational evidence. The hosted account/session integration check passed, but it bypassed email delivery and does not prove public onboarding. Supabase's free default email provider rejected the code-template change without custom SMTP or an upgrade, so keep `EMAIL_SIGNIN_ENABLED=false` until a real inbox completes the full flow. The managed-upload credential is also not configured yet.

A dedicated live HOODLABS portal configuration has been created with payment-method updates, invoice history and cancellation at the end of the paid billing period. The application must use a portal configuration whose cancellation policy matches the terms shown to customers. Register `/api/stripe-webhook` for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and subscription `checkout.session.completed` events. The endpoint checks exact raw-body signatures and Stripe mode, then refetches current exact-customer/exact-price state before a version-fenced database commit. Actual Pro authorization comes from a live active exact-price Stripe subscription, a current-session verified wallet holding at least 666,666 HOODRICH, or an exact server-configured wallet grant after that same proof and chain validation. A redirect, webhook claim or stored snapshot never grants access. The providers remain independent: a verified positive result on any authoritative path suffices even if another provider is unavailable.

## Holder eligibility

No holder token/RPC values come from the client. The server pins Robinhood Chain 4663, the official HOODRICH contract `0x6d5dc12131b2ad8748C54aB1Ac1b1a2cC53c2118`, 18 decimals, and the inclusive 666,666-token threshold (`666666000000000000000000` smallest units). The public chain RPC is used for confirmed canonical balance/code checks. Email authentication and a fresh ownership message in the current one-hour session are required. No transfers, token approvals or custody are involved in proving holdings.

Test nonce replay, concurrent verification, expiry/logout/unlink races, cross-account uniqueness, wrong origin/chain/address, balance changes and RPC failures against the migrated business test database before enabling access. Confirm holder-only accounts never get routed to a nonexistent subscription portal. Qualifying holders do not automatically cancel paid subscriptions.

## Source and deployment checks

Use Node 24, run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `node scripts/check-release.cjs`, and `npm audit --omit=dev --audit-level=moderate`. Bind review evidence to the exact Git revision that is deployed. Check the compiled site in a separate browser session; never reload an unlocked local wallet workspace as part of deployment testing.

Git deployments are disabled in `vercel.json` until the repository/project mapping and release process are checked. Keep Vercel authentication protection enabled for preview releases. Add only `labs.hoodrich.rip` to the new project and follow Vercel's exact DNS instruction; leave the root and `www` records untouched. Verify the deployed TLS certificate, nonce Content Security Policy, cache controls, missing owner endpoints, account error handling and mobile guides.

The public Vercel fallback `hoodlabs.vercel.app` redirects only GET/HEAD HTML document navigations to the exact configured canonical origin with a temporary no-store 307. APIs, assets, POST requests, previews, localhost and other hosts do not redirect. Keep `APP_ORIGIN=https://labs.hoodrich.rip`; do not add fallback origins to account write guards or cookie scope.

## Before enabling sales or signing

Complete the operational checks in [SECURITY.md](SECURITY.md): real test-mode signup, Checkout, repeated clicks, delayed provider responses, cancellation, portal return, expired sessions, cross-user isolation and upload quotas. No real withdrawals, bridges, token launches or charges are needed for an initial protected preview. Financial release requires a qualified human decision under this project's release policy; automated tests and model reviews do not replace an independent custody audit.

Set provider spending alerts and quotas, choose support/privacy/terms contacts, and document database backup and restore ownership. Keep the previous verified deployment available for rollback. If verification fails, keep signing and new subscriptions disabled and preserve transaction/checkout evidence; do not reset records to force retries.

Key principle: publish the reviewed app independently, then enable paid financial tools only when the business services and recovery paths are verified together.
