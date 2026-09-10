# HOODLABS hosting and subscription setup

The public app is a separate source release. Do not deploy the original local operator folder or copy its `.env.local`, wallet backups, withdrawal journals or Git history.

| Resource | Intended target |
| --- | --- |
| GitHub | `txc0ld/hoodlaunch` |
| Vercel team / project | `tx-build` / `hoodlabs` |
| Public address | `https://launch.hoodrich.rip` |
| Existing website | Leave `www.hoodrich.rip` and Vercel `hood-rich` intact |
| Stripe business account | Fantom Labs, `acct_1TFnGyBSWo9IPsgC` |
| Stripe product | `prod_hoodlabs_pro`, HOODLABS Pro |

The requested subscription is $6.90 per month. Currency must be confirmed before creating its recurring price; the business account defaults to AUD. Do not use an unrelated price or create a customer subscription manually. Customers subscribe through their own authenticated HOODLABS Checkout session.

## Server configuration

Set these in the **new** Vercel project's environment settings. Never prefix credentials with `NEXT_PUBLIC_`, commit them, or paste them into support chat.

| Variable | Meaning |
| --- | --- |
| `APP_ORIGIN` | Exact deployed HTTPS origin, without a trailing slash. Preview account calls must use that preview's explicitly configured origin. |
| `LIVE_LAUNCH_ENABLED` | Defaults to `false`. Both signing tools and new paid Checkout sessions remain disabled until the financial release decision and operational checks are complete. |
| `SUPABASE_URL` | URL of a new business Supabase project. |
| `SUPABASE_ANON_KEY` | Key for that project's email-code identity flow. It is used only on the server in this implementation. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access for revocable sessions, billing mapping and quotas. |
| `STRIPE_SECRET_KEY` | Business Stripe API key, from the same account and mode as the Pro price. Never use the operator's exchange or wallet keys. |
| `STRIPE_PRO_PRICE_ID` | Verified active recurring HOODLABS Pro price, monthly, 690 minor currency units. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated HOODLABS billing portal configuration; live catalog ID `bpc_1UDxZCBSWo9IPsgCDQGAA4YZ`. Use a separate test configuration for test-mode checks. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this deployment's Stripe webhook endpoint. |
| `PINATA_JWT` | New business-scoped upload credential; do not copy the owner's existing personal token. |

Use separate test and live provider configuration. Run `db/001_public_services.sql`, then `db/002_holder_access.sql`, once against the new Supabase project after verifying its target. Migration002 adds service-only holder links, challenges and current-session proofs; retain both migrations in order. Enable email OTP with a code-bearing template, configured SMTP and appropriate provider send limits. Schedule the expired session/quota cleanup described in the migration. Test anonymous/authenticated roles cannot read service tables.

A dedicated live HOODLABS portal configuration has been created with payment-method updates, invoice history and cancellation at the end of the paid billing period. The application must use a portal configuration whose cancellation policy matches the terms shown to customers. Register `/api/stripe-webhook` for subscription and Checkout lifecycle events. The endpoint checks signatures; actual Pro authorization comes from an active, exact-price Stripe subscription OR a current-session verified wallet holding at least500,000 HOODRICH. A redirect or webhook claim never grants access. The two providers are independent: a verified positive result on either path suffices even if the other provider is unavailable.

## Holder eligibility

No holder token/RPC values come from the client. The server pins Robinhood Chain4663, the official HOODRICH contract `0x6d5dc12131b2ad8748C54aB1Ac1b1a2cC53c2118`,18 decimals, and the inclusive500,000-token threshold. The public chain RPC is used for confirmed canonical balance/code checks. Email authentication and a fresh ownership message in the current one-hour session are required. No transfers, token approvals or custody are involved in proving holdings.

Test nonce replay, concurrent verification, expiry/logout/unlink races, cross-account uniqueness, wrong origin/chain/address, balance changes and RPC failures against the migrated business test database before enabling access. Confirm holder-only accounts never get routed to a nonexistent subscription portal. Qualifying holders do not automatically cancel paid subscriptions.

## Source and deployment checks

Use Node 24, run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `node scripts/check-release.cjs`, and `npm audit --omit=dev --audit-level=moderate`. Bind review evidence to the exact Git revision that is deployed. Check the compiled site in a separate browser session; never reload an unlocked local wallet workspace as part of deployment testing.

Git deployments are disabled in `vercel.json` until the repository/project mapping and release process are checked. Keep Vercel authentication protection enabled for preview releases. Add only `launch.hoodrich.rip` to the new project and follow Vercel's exact DNS instruction; leave the root and `www` records untouched. Verify the deployed TLS certificate, nonce Content Security Policy, cache controls, missing owner endpoints, account error handling and mobile guides.

## Before enabling sales or signing

Complete the operational checks in [SECURITY.md](SECURITY.md): real test-mode signup, Checkout, repeated clicks, delayed provider responses, cancellation, portal return, expired sessions, cross-user isolation and upload quotas. No real withdrawals, bridges, token launches or charges are needed for an initial protected preview. Financial release requires a qualified human decision under this project's release policy; automated tests and model reviews do not replace an independent custody audit.

Set provider spending alerts and quotas, choose support/privacy/terms contacts, and document database backup and restore ownership. Keep the previous verified deployment available for rollback. If verification fails, keep signing and new subscriptions disabled and preserve transaction/checkout evidence; do not reset records to force retries.

Key principle: publish the reviewed app independently, then enable paid financial tools only when the business services and recovery paths are verified together.
