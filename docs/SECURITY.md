# Release security record

This application is prepared as a non-signing preview by default. It is not an audited custody product or a guarantee of safe investment.

| Risk | Likelihood | Mitigation / remaining decision |
|---|---|---|
| Owner secrets copied into public deploy | High without packaging separation | Clean repository with source allowlist; no owner server/history/environment; runtime variables business-owned only; scan final source and browser artifacts. |
| Cross-user billing/upload access | Likely under attack | Server-generated opaque sessions verified in DB; no client user-ID authority; RLS-denied service tables; exact-price live Stripe check; test hostile direct requests. |
| Duplicate checkout or event replay | Common retry condition | DB stores the exact checkout request and fixed expiry, binds Stripe session identity and serializes verified terminal-state replacement; unknown creation outcomes stop for reconciliation. Entitlements never derive from webhook order or redirects. |
| Upload abuse / bill shock | Likely on a public site | Atomic per-user/global quotas, authenticated active Pro, raster-only decode/reencode, 4MB/16MP limits and timeouts; configure WAF and provider spend alerts. |
| Compromised browser/deployment | Lower probability, critical impact | No third-party scripts; nonce CSP; supported framework; keys in memory with explicit lock; hardware wallet recommended. Browser signing still trusts deployed code. Qualified security review required before financial release. |
| RPC lies / protocol upgrade | Possible | Fixed chain/address/runtime anchors and transaction/receipt validation; mismatch fails closed. Providers and audited deployment provenance remain trust dependencies. |
| Interrupted or duplicate chain submission | Common network/browser failure | Persist public intent before signing, canonical confirmations, guarded recovery, no auto-resend. Hashless ambiguity stays blocked. Cross-device coordination is not provided. |
| Dependency compromise | Possible | Pinned lockfile, Node24 clean build, production audit and no source maps. Ethers5 elliptic dependency has low advisories; review before custody production, migrate separately rather than change cryptography during hosting work. |
| Account-provider outage | Possible | Pro fails closed; free external-wallet launch configuration is independent. No fallback to owner credentials or paid entitlement from cache. |
| Existing site overwritten | Possible deployment mistake | Separate launchpad Vercel project/subdomain; default Git deployment disabled until exact mapping checked. |

## Required operational checks

- Run migrations and cross-tenant tests on an isolated real Supabase project. Local PGlite SQL tests do not prove production roles, settings or SMTP configuration.
- Run Stripe test-mode signup/payment, duplicate click, cancellation, past-due, portal and webhook signature tests with actual business configuration. No live charges during validation.
- Validate native image decoding and quota behavior in Vercel's Linux artifact. Preview pages must have nonce CSP, no-store, no third-party script injection and no credential echoes.
- Inspect complete clean Git history and browser artifacts for secret canaries; preserve no owner backups, keys or financial journals in Git, hosting or reports.
- Configure least-privilege deployment access, MFA, branch protection, protected preview environments, provider quotas, cost alerts, abuse/support contacts and restore/rollback procedure.
- Independently review wallet signing and protocol assumptions. Use test wallets/test funds only after explicit authorization. Generated model reviews do not substitute for an independent custody audit.

Key Principle: monetize isolated services without taking custody of customer or owner funds.
