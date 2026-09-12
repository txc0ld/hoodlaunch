# Independent PONS launch gates

Base: `9b0a51d0175f3f8d717ae459e650f6a1bfea1d47`. R3 boundary integration under the approved PONS-only launch contract. Candidate: the commit containing this record. Status: implemented; independent verification, fresh review and root-owned release gates remain pending. No worker deployment or live funded operation.

`LIVE_LAUNCH_ENABLED` now controls only PONS token launching. The server reads independent exact-literal-true `PRO_SALES_ENABLED` and `NODE_FINANCE_ENABLED` values; both default false. Home passes these through Hoodlaunch to ProAccess sales and the wallet workspace. Checkout rejects unavailable sales before account, quota or provider calls. Existing subscription portal, authentication and entitlements are unchanged.

NodeManager finance requires Pro plus the finance flag. WalletWorkspace keys its lifetime on finance rather than launch availability: finance revocation forgets the vault and rejects old callbacks; launch-only changes preserve the wallet session. Generation and trading flags remain independent. The user-facing unavailable checkout message no longer refers to launching.

Invariants and threat assumptions: malformed/missing flags fail closed; public/client claims cannot authorize checkout; delayed wallet callbacks can outlive their owner and must not retain signing authority after revocation. The existing layout cleanup and vault active-session checks enforce revocation. An already broadcast transaction remains governed by its existing recovery record. No vault, signer, transaction amount, provider, launch ABI, receipt, checkout core, schema or subscription rules changed.

Rollback/recovery: keep the new sales and finance flags false; roll back this source change only together with closing launch if the previous coupled behavior must be restored. Finance/account/access changes require encrypted backup restoration; transaction recovery records remain intact.

| Check | Observed result |
| --- | --- |
| Node24 `--test tests/wallet-workspace.test.js tests/public-services.test.js tests/public-holder.test.js` | PASS, 45 tests, exit 0 |
| Node24 `--test tests/public-checkout.test.js tests/pons-core.test.js` | PASS, 77 tests, exit 0 |
| Actual Pons SSR matrix | PASS, 64 generation/trading/account/Pro/launch/finance combinations; independent Home/Hoodlaunch sales/finance propagation and exact flags covered above |
| Windows Node + Edge `tests/wallet-workspace-browser.cjs` | PASS, six revocations, stale callbacks rejected; launch toggle preserves session; actual NodeManager with verified inert vault mounts finance tools only with finance enabled; exit 0 |
| Node24 `node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0 |
| `git diff --check` and allowlisted path/core comparison | PASS, exit 0; eight critical files byte-identical to base |
| Limited added-line private-key/Stripe-secret literal scan | PASS, zero matches; this is not a full credential audit |
| Production build, compiled responsive smoke, independent review/verification | NOT_RUN by builder; root owns these gates |
| Live funded launch, checkout, bridge or trade | NOT_RUN |

Full logs and patch: shared task workspace `work/public-release/verification/full-release/pons-v2-compatibility/builder/`. `candidate.json` binds observed command exits to the frozen commit. `scope-scan.json` lists inspected paths. Browser vault/provider fixtures are inert; this is not evidence of a funded transaction or the separately investigated user backup issue. Model token usage is unavailable/unknown.

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Launch configuration opens unrelated financial functions | Covered by source and component tests | Separate exact-true sales and finance gates |
| Finance revocation leaves old authority | Covered by lifecycle tests | Existing synchronous vault invalidation, finance in owner key |
| Source rollback restores old launch coupling | Operational | Close launch before rollback; root-owned release decision |

Key principle: enabling PONS launching authorizes only PONS launching.
