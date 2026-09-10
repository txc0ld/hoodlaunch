# Wallet workspace restoration

Base: `e02aa0d017c3ccc8322cb120ce396ef672d12715`. R3 integration boundary; candidate is the commit containing this record. Independent verification, fresh review, and human release decision remain required.

The independent exact-true `NODE_TRADING_ENABLED` server flag now reaches the wallet workspace. Generator availability requires generation plus signed-in identity; trading additionally requires Pro and trading availability. All states remain discoverable. Funding and bridge retain the existing Pro plus launch gate. Wallets remain above the launch form and trading below; navigation links directly to both and the account panel.

The keyed `WalletWorkspace` owns the shared node session. Identity, Pro, generation, trading, or launch changes replace the owner. Its layout cleanup invalidates the existing vault with `forgetNodeSession`, while stale callbacks are rejected. Launch draft and receipt state remain in the parent. The signing, backup, recovery, allowance, trading and batch implementations are unchanged.

Threat assumptions and invariants: authenticated identity/access props come from the existing account component; delayed child callbacks and pending asynchronous work can outlive their UI owner. Such work must not publish an old vault into a new owner or retain signing authority after commit. An already broadcast transaction cannot be revoked; existing pending-operation records and recovery remain authoritative.

Recovery: account or capability changes require restoring the encrypted backup. Rollback disables the independent trading flag or reverts this commit; no migration or transaction records change.

| Check | Observed result |
| --- | --- |
| Node24 `--test` wallet-workspace, node-generation-allowance, node-generation-client, node-vault, node-trading, node-trade-batch, node-balances | PASS, 64 tests, exit 0 |
| Actual PonsLaunchpad React SSR availability matrix | PASS, all 32 flag/account/Pro combinations; wrapper and exact-true flag tests included above |
| Windows Node + Playwright Edge `tests/wallet-workspace-browser.cjs` | PASS, six revocation cases and ten stale layout callbacks; zero modeled signatures/broadcasts, exit 0 |
| Node24 `node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |
| Compiled responsive UI, full build, independent verification/review | NOT_RUN by builder; root owns final gates |
| Real funded execution | NOT_RUN; no money moved |

Browser scope: actual parent component and React lifecycle, mocked NodeManager/NodeTrading/vault. The lifecycle test models the unchanged vault's active-session checks; it does not independently prove cryptographic execution. Existing vault/trading suites cover those implementations.

Full logs: `work/public-release/verification/full-release/wallet-workspace-restoration/builder/wallet-workspace-{focused,browser,typecheck}.log`; production patch beside them. Paths are relative to the shared task workspace, outside this worktree. Model usage is unavailable/unknown.

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Stale owner resumes a trade | Covered by lifecycle and existing core tests | Synchronous vault invalidation; immutable owner boundary; unchanged pre-sign/broadcast checks |
| Access/flag refresh disrupts a loaded vault | Expected on actual capability changes | Encrypted backup restoration; pending records preserved |
| Funded execution differs from mocks | Unmeasured | Required independent review and qualified release decision; no claim of funded execution |

Key principle: wallet tools have independent availability, while account changes revoke the old signing session.
