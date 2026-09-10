# Custom launch pairs

Status: READY FOR INDEPENDENT VERIFICATION AND REVIEW; base b2e2ba722ccacff48987e6aa401bc035d5377f12, feature/pair-discovery. Owner: critical builder. Usage unavailable.

Contract: Free custom factory-approved ERC-20 launch pairs; native ETH default unchanged. Custom launch is factory-only, zero initial developer buy, launch fee/gas native ETH. No allowances, generalized trading, lists of invented assets, secret access or deployment. Root owns form integration and generated-node trading restrictions.

Invariants: canonical nonzero asset address and deployed code; factory approval; positive per-asset economics; factory/token decimals equal and within 0..36. Bind fresh economics fingerprint, decimals/reserves/threshold and address to frozen preparation, final pre-send checks, v2 journal calldata and canonical receipt. Retain strict v1 ETH records under the existing shared account lock/storage key. Reject malformed/version-confused records. Unknown outcomes remain blocked for reconciliation; never auto-delete records. Failed custom inspection must invalidate UI metadata and never enable launch. Symbols are bounded untrusted text.

Threat assumptions: factory is pinned nonproxy runtime; public RPC availability/integrity is existing trust boundary; ERC-20 metadata can revert, change or be malicious. Approval can change between reads and mining: expectedEconomics plus factory execution enforce transaction terms; pre-send checks reduce stale prompts. Historic recovery metadata reads may fail closed if protocol state changes within receipt block.

Acceptance: existing native core tests; custom direct calldata/value; rejection of developer buy, unapproved/missing code/bad decimals/economics/metadata; changed approval/economics/metadata before send; custom event/address/threshold verification; v2 reload recovery and tamper/version rejection; inspector no wallet calls; TypeScript. Independent verification and fresh Astra review are required after integration. Qualified human release decision remains required; live signing disabled.

Source: cached work/pons/docs-v2.txt quote asset section, independently confirmed deployed verified ABI from https://sourcify.dev/server/v2/contract/4663/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e?fields=abi (2026-09-10). approvedPairTokens(address)->bool; pairTokenEconomics(address)->uint256,uint256,uint8. Full fetched ABI and observed live runtime selector proof: work/public-release/verification/lab-redesign/custom-pairs/. RPC runtime hash matched the pinned hash; selectors 0x9831705e and 0x31082134 were both present. Read-only methods only.

Recovery/rollback: revert owned code commit before release, retain all existing journal data; old application rejects custom v2 records safely. No storage migration/deletion, production operations or transactions performed.


Implementation: optional LaunchDraft.pairToken; optional frozen PreparedLaunch.pair: PairAsset; optional LaunchReceipt.pairToken. Native omission/zero preserves behavior. PairSelector immediately invalidates input, debounces public inspection, ignores stale completions and displays canonical address, decimals and quote-denominated economics. Root owns mounting and review/config denomination display.

| Check | Result |
|---|---|
| Node 24 node --test tests/pons-core.test.js at base | PASS, 42/42, exit 0 |
| Node 24 node --test tests/pons-core.test.js after changes | PASS, 55/55, exit 0 |
| Node 24 npm run typecheck | PASS, exit 0 |
| git diff --check | PASS, exit 0 |
| Sourcify verified ABI + live RPC chain/runtime/selectors | PASS, exit 0 |
| UI behavioral browser verification, integrated full suite/build | NOT_RUN by builder; root/independent verifier owns |
| Independent verification and fresh final review | NOT_RUN by builder; required before acceptance |

Full logs and candidate file hashes: work/public-release/verification/lab-redesign/custom-pairs/ (outside repository). Code commit is reported in the task handoff. No dependencies or lockfiles changed. node_modules is a local symlink for existing dependencies, excluded from the commit.

| Risk | Likelihood | Mitigation |
|---|---|---|
| Approval/economics changes after checks | Possible | Repeat final checks and bind factory expectedEconomics; contract execution remains authoritative |
| Custom metadata or protocol state changes within the receipt block | Low | Historical verification fails closed; preserve unknown record for manual reconciliation |
| UI metadata lookup resolves after user changes address | Possible | Immediate invalidation, request generation guard, render result only for current input; independent browser check pending |
| Unsupported ERC-20 buy or generated-node trading | Prevented by bounded scope | Custom developer buy rejected in core; root preserves existing ETH-only trading guard and adds disclosure |

Next action: root integrates owned commit with the form, then obtains independent verification and fresh Astra review on the combined revision. This implementation is not self-approved and does not authorize financial release.
