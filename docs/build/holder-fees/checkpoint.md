# Holder fees — current checkpoint

Status: staged read-only implementation; financial routing **BLOCKED** by missing independently verifiable distributor source, bindings and mutable dependency semantics. Candidate is the commit containing this checkpoint, based on `c1bb71f1bcad2b14d600af2a921b5772da186295`.

Implemented: free launch toggle; both prepare/execute blocked when selected; normal creator launch preserved; prepared preference identity/recipient binding; launch success isolated from holder bookkeeping; canonical read-only status with observed proxy/implementation drift checks; duplicate check latch, wallet/lifecycle stale-result rejection, bounded request timeout; unconditional closed write API; official claim link and explicit unverified states.

Checks observed on Node `v24.21.0`:

| Check | Result | Evidence |
| --- | --- | --- |
| Initial focused tests | PASS 62/62, exit 0 | `../verification/holder-fees/checks/focused.log` |
| Final holder + launch regression tests | PASS 118/118, exit 0 | `../verification/holder-fees/checks/holder-and-launch.log` |
| TypeScript | PASS, exit 0 | `../verification/holder-fees/checks/typecheck.log` |
| `git diff --check` | PASS, exit 0 | Local command observed |
| Integrated full suite/build/browser | NOT_RUN by this writer | Parent integration owner |
| Independent verification/fresh review | NOT_RUN by this writer | Parent mandatory gates |
| Setup simulation, transaction/retry, claims, deployment | NOT_RUN | Financial write implementation blocked; no network writes |

Tests use generated inert token/account/distributor addresses, actual retained observed runtime fixtures, and mocked providers. They do not verify a live payout system. Full task remains incomplete until routing trust is resolved and mandatory independent gates pass. No self-approval, release decision, or risk waiver given. Usage unavailable/unknown.

Next owner: parent integrates staged candidate, obtains independent verification and fresh review, and reports routing blocker honestly. Trust recovery requirements: `trust-evidence.md`; user explanation: `guide.md`. The local `node_modules` symlink is a development-only dependency reuse artifact and is excluded from the commit.
