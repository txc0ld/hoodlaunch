# Email readiness and canonical entry-point contract

Status: implementation candidate under verification. Base: `7c749e858e474fd37831fcbfaa386b5815f194cb`.

Scope is limited to the approved R2 email-readiness preflight, canonical-origin addendum and billing-navigation addendum. `EMAIL_SIGNIN_ENABLED` is server-only, defaults closed and accepts only exact `true`. Both OTP actions reject before database, quota, authentication-provider or cookie work when disabled. Account status always returns the server-derived `signInAvailable` boolean. Existing session status, Pro checks, logout, billing portal and signed webhook processing do not depend on this gate. The UI offers the OTP form only for exact boolean `true` and explains the disabled state without hiding existing-session controls.

Authenticated status also reads Stripe-customer navigation metadata concurrently with Pro status under the same eight-second upper bound. Missing customer is known false; lookup failure or timeout is unknown and cannot deny or grant Pro. Status never creates a customer. The UI shows billing navigation only when an existing customer is server-verified, preserves subscription management for paid accounts and keeps first-time Checkout controlled by billing/sales readiness. The portal route remains authoritative and rejects a missing customer.

The exact public fallback host `hoodlabs.vercel.app` temporarily redirects GET/HEAD HTML document navigations to configured `https://labs.hoodrich.rip`, preserving the path and query through URL setters. APIs, assets, mutations, previews, localhost, foreign hosts and invalid canonical configuration continue normally. Forwarding headers cannot select either host. Account CSRF origin enforcement and CSP behavior are unchanged.

Non-goals: SMTP configuration, provider mutation, deployment, database/schema changes, dependency updates, wallet/crypto/trading changes, billing enablement and `LIVE_LAUNCH_ENABLED` changes.

Acceptance evidence is stored outside the source candidate at `../verification/full-release/email-readiness/`. Mandatory independent verification and fresh exact-candidate review remain owned by the release coordinator.

Key principle: expose one canonical session origin and advertise email sign-in only after its complete delivery path is proven.
