# Wallet-node buy speed

User request: improve the speed of buys using Hoodlabs wallet nodes.

Repository: txc0ld/hoodlaunch. Base: 87e1be50a918f145f6b5015c4138c88558f20856. Original worktree clean. Isolated worktree: /home/tx/projects/hoodlabs-buy-speed, branch perf/wallet-node-buy-speed.

Risk R3 because execution validates and signs financial transactions. Root Astra High owns design. Design is pending a reproducible latency baseline. A designated critical builder will own the bounded implementation. Independent Sol High verification and fresh Astra High source review are required. Roles are bound by the available native tool definitions and checked local role files. Usage is UNKNOWN unless tool telemetry supplies it.

## Scope

Measure click-to-submission preparation and execution for individual node buys and the existing all-node batch. Reduce avoidable RPC serialization with a small change supported by measurements. Prefer shortening independent read dependencies within each trade. Do not change transaction write ordering or user approval semantics merely for throughput. Production deployment and funded transactions are outside this request.

## Invariants

- Keep fresh execution checks for chain, runtime code, token/curve identity, phase, balance, nonce, fees, gas, simulation and quote. Preserve the 2 percent slippage bound, gas reserve, deadlines and calldata validation.
- Preserve one-use reviews, verified vault ownership, per-node browser lock, selection/session/expiry guards before signing and before broadcasting, durable recovery before sending, one send only, and unknown-outcome reconciliation.
- All-node batches remain ordered, stop on error/unknown/cancellation, and cannot send later nodes after stop. Preparation remains bounded to three nodes unless an independently verified design revision justifies changing it.
- Keep sell approvals explicit and separate. No speculative quote or code cache across operations. No provider changes, higher fees, weaker confirmations, new automatic retries, production keys, live transactions or deployment.

## Relevant code and acceptance

NodeTrading.tsx handlers call node-vault.ts wrappers, node-trading.ts preparation/execution, and pons-trade.ts RPC/quote helpers. node-trade-batch.ts composes up to 50 nodes. Existing tests/node-trading.test.js uses actual TypeScript modules against fixture RPC/contracts; tests/node-trade-batch.test.js verifies batch sequencing.

Acceptance: deterministic latency/scheduling repro on the actual prepare/execute path with a failing baseline and passing candidate; record before/after round trips or timed fixture results without presenting them as live-chain speed. Exercise wrong chain/code, moved price/phase, nonce/balance/gas change, simulation failure, expiry/selection invalidation, duplicate clicks, storage failure and unknown send. Existing full tests, typecheck and build must pass on Node 24. Candidate source hashes or revision must bind validation and fresh independent review.

## Current state

Discovery complete. No application source edits. Baseline and latency repro pending. The old public-release checkpoint describes an earlier release; current base is the clean 87e1be5 checkout. This task does not inherit deployment authorization from historical files.

## Added user symptom

Sell All Nodes briefly appears to refresh the page and logs the wallet out. Diagnose actual NodeTrading -> WalletWorkspace -> NodeManager / ProAccess lifetime, account refresh failures, and navigation. Reproduce before fixing. Preserve genuine logout, identity/capability change, idle expiry, and fail-closed signing. Do not retain signing entitlement after verification fails. Root will approve a bounded R2 account/UI design once a red-capable reproduction distinguishes causes. Do not assume this symptom is a broadcast error or lower signing safety to hide it.

## Buy design preflight

Root is the designated critical implementation owner for a narrow provider change. Replace only the trade RPC provider with ethers 5 StaticJsonRpcProvider using the existing immutable URL and explicit chain ID 4663. Its scope is fixed HTTP RPC, never the connected browser-wallet provider. Preserve all explicit assertTradeChain calls, which send eth_chainId directly and do not use cached network metadata. No quote, nonce, code, balance, transaction, review, gas or fee caching. No removed checks, changed batch concurrency, or changed RPC dependencies. Existing mocks must expose the provider class used by production.

Evidence: Node 24.21.0; npm ci exit 0, package/lock unchanged. Existing node-trading 31/31 and node-trade-batch 9/9 passed independently. A loopback HTTP probe using actual ethers found 23 requests (13 chain checks) for ten read stages with JsonRpcProvider, vs 12 requests (two explicit chain checks) using a fixed-network provider. Fixture timings were 607ms/319ms with each response delayed 25ms. This isolates provider overhead and is not a live-trade benchmark. Full prepare/execute latency verification is pending before implementation.

Primary reference: https://docs.ethers.org/v5/api/providers/jsonrpc-provider/#StaticJsonRpcProvider describes redundant network-detection calls and fixed-network usage. The installed ethers 5.8.0 implementation is the final API reference.

Rollback: revert the provider constructor and corresponding test fixture, without changing stored operations or wallet material. Source validation will use full tests, typecheck, build, release scanner, independent behavioral verification and fresh Astra High review. No live deployment is authorized by this task.

## Sell session design preflight and approved repair

Independent Sol High owner reproduced actual React Sell All + focus-return + one injected status503. Plain click: one initial status request, zero window-focus events, zero vault forgets, no navigation or page error. Focus-return/status503: second status request clears identity/pro, WalletWorkspace unmounts, one vault forget, trading disappears without navigation. This matches the visible symptom but is not a trace from the user device.

Approve one retry for the read-only ProAccess status request only, within one shared existing20-second AbortSignal deadline. Retry eligible network failure/HTTP408,425,429,5xx once; preserve final error messages and no state callbacks until final outcome. No replay of login, signatures, logout, billing, holder-link or any mutating action. Never retry valid unsigned-out/pro-false responses, authentication4xx, invalid successful JSON, or aborted deadline. If429 carries Retry-After, do not retry before it; simplest safe disposition is no429 retry rather than adding scheduling complexity. Prefer excluding429 for the bounded implementation.

Preserve fail-close clearing on two failures, exhausted deadline, pending auth/storage failure, genuine identity/capability changes and pagehide. Guard stale response application through existing generation/account-mutation/mount checks. No wallet lifetime/owner key changes, signing authorization extensions, or automatic account mutations. The original20-second request deadline must include both attempts.

Verification: actual React Sell All click, successful transient recovery preserving the same loaded session, nonretryable auth failure, two failures, deadline, signed-out response, Pro revocation, pagehide, and stale response after logout. Keep network requests and wallet signing mocked. Full candidate tests/typecheck/build plus existing account/wallet lifecycle browser coverage and fresh independent review.
