Task and phase: wallet Pro grant plus subscription snapshot store; source candidate ready for exact-revision review.
User objective: grant Pro to one server-configured wallet after existing proof, and record current Stripe subscriptions in Supabase.
Authority already granted: bounded source, migration, tests and narrow docs listed in contract. No deployment, external writes, dependency or unrelated handler changes.
Live spec: docs/build/wallet-pro-grant/contract.md and injected AGENTS.md build/review policy.
Worktree / branch / exact base: wallet-pro-grant / codex/wallet-pro-grant / 99077c0b804b5cd906221546907be15fa1e604c4. Candidate is the commit containing this checkpoint.
Dirty work to preserve: none observed outside the contracted task paths.
Scope: public-wallet-grants, holder/services Pro decisions, shared Pro model/UI, subscription store, migration 003, Stripe webhook, focused tests, env/hosting docs.
Non-goals: provider/signature proof changes, financial handlers, dependencies/lockfile, deployment or applying SQL.
Mandatory acceptance: exact bounded allowlist after fresh holder proof; distinct granted flag; unchanged 666666 and US$15 paths; snapshots never authorize; current Stripe retrieval; hood_billing-only customer ownership; mode/price/account checks; monotonic begin/complete fence; atomic processed receipt; retry on storage failure; service-role-only SQL/RLS.
Current evidence: baseline npm test PASS 248/248 and baseline typecheck PASS; pre-fix regression suite FAIL as expected; final focused tests PASS 54/54; final npm test PASS 264/264; final npm run typecheck PASS. Full logs are under ../verification/wallet-pro-grant/implementation/. Release scan is NOT_RUN because it requires `.next/static`; root owns the combined build artifact.
Review verdict: preliminary independent harness PASS 10/10 before freeze. Its binding-race hypothesis was repaired by locking the exact hood_billing row through complete transaction commit. Exact-candidate independent verification and fresh review remain required.
BLOCKED / owner: migration003 application and webhook registration wait for root's exact-candidate gates. Public email-code sign-in waits for custom SMTP or Supabase upgrade. Webhook secret is unavailable through the connected Stripe OAuth surface. The configured sensitive Vercel Stripe key cannot be read back locally, so its identity/mode remain unverified.
Next action: commit, send exact SHA to root/verifier, then root integrates and runs required review/build gates before applying migration003.
Evidence index: ../verification/wallet-pro-grant/implementation/.
Usage: UNKNOWN.
