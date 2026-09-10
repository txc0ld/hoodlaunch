# Launched-token holder fees — R3 contract

Base: `c1bb71f1bcad2b14d600af2a921b5772da186295`; isolated `codex/holder-fees` worktree. Critical implementation owner: assigned Astra High session. Independent verification and fresh Astra High review belong to the parent; no self-approval or release authority.

## Scope and invariants

Free basic launch intent redirects each launched token's future **creator fee share** to that token's holder distributor. It does not distribute the whole trade fee, prove HOODRICH Pro eligibility, promise yield, or implement claims/epoch creation. Holder claims use the official PONS profile.

1. Selecting holder sharing invalidates prepared review; launch recipient is the connected launch account, never a stale custom recipient. Intent is snapshotted into the prepared review and bound to its confirmed launch transaction/token.
2. Launch success survives independent setup failure. Separate setup requires up to two additional wallet approvals and communicates pending, partial, and confirmed states. Recipient routing cannot be undone by the original creator through the standard transfer method; protocol-owner overrides remain possible.
3. No setup writes until factory proxy, EIP-1967 implementation and dependencies, distributor token/factory binding, and exact method semantics have a reviewed trust manifest. Runtime presence or a client bundle alone does not establish distributor correctness.
4. Before every permitted send, verify selected provider identity/version, account, chain 4663, enabled gate and mount/operation epoch; simulate and estimate the exact fixed-contract/value-zero call. Current creator recipient must be caller. Reconcile live mapping and canonical receipt before retry or reporting enabled; uncertain sends never blind-resubmit. Duplicate calls share a latch.
5. No arbitrary distributor input, claims backend, private keys, deployments, production writes, package/lock changes or bypass of wallet confirmation.

Allowed paths: new `src/lib/pons-holder-fees.ts`, holder-fee component/CSS, narrow `src/components/PonsLaunchpad.tsx` edits, focused holder-fee tests/fixtures, `docs/build/holder-fees/` and brief guide. Excluded: Pro, server, billing, wallet registry/signature proof, trading, shared runtime trust changes.

## Acceptance and recovery

Run focused Node tests (production module transpilation and mocked generated addresses), launch regression tests, TypeScript. Test toggle binding, cancellation/change/failure/retry, unknown outcome, incorrect chain/runtime/implementation/recipient/mapping/token, duplicate clicks, and zero sends under disabled live gate. Parent owns integrated build/browser checks and exact-candidate review.

When trust evidence is missing, implement read-only readiness plus honest blocked setup UI and keep the write boundary unconditionally closed. Selecting holder sharing MUST block both launch preparation and execution, preserving ordinary creator-fee launches when deselected. Local changes are recoverable by reverting the eventual commit; no transaction rollback is promised. Persisted UI intent is untrusted and cannot authorize a send or establish confirmation.

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Distributor implementation/source unavailable | Observed | Block writes pending independently verifiable bindings and dependencies |
| Wallet or launch intent changes during awaits | Material | Snapshot and recheck epoch/provider/account; discard stale results |
| Two-step setup partly completes or response is lost | Material | Preserve launch receipt; reconcile mapping/receipt, never blind retry |
| Upgrade changes trusted behavior | Material | Pin proxy, implementation slot/runtime and dependency surface before writes |

Key principle: a holder-fee preference is not proof that fees have been routed.
