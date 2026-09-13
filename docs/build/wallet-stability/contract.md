# Wallet transaction stability

Request: Max Sell All fails after Max Buy All; intermittent page refresh/jump; automatic completion status and holdings refresh; one manual Refresh All transactions/nodes control; stable prompt submission. User asks to determine and implement the best approach. Standing authorization from this conversation includes test and ship to existing Hoodlabs after required gates. No real funds,owner keys/backups,signatures,charges or unrelated deployments.

Base55ba8786895428e5579ffde889564c48cefd1f13 is prior shipped Hoodlabs release; remote main verified. Candidate /home/tx/projects/hoodlabs-wallet-stability. Package/lock unchanged; Node24.21.0,ethers5.8.0,React19.2.6,Next16.3.4; prior440-case baseline evidence is at the same source and lock, not a new-candidate test. New exact-candidate checks required.

## Ownership and risk

R3 financial changes: designated critical_builder AstraHigh owns node-trading.ts,node-trade-batch.ts,pons-trade.ts and focused tests in /home/tx/projects/hoodlabs-max-trades. Root AstraHigh owns design/contracts/integration. R2 read lifecycle/UI: complex_builder SolHigh owns NodeTrading.tsx/CSS,NodeManager.tsx and PonsLaunchpad.tsx only for refresh bridge plus focused tests in /home/tx/projects/hoodlabs-wallet-status-ui. Independent verification_engineer SolHigh in /home/tx/projects/hoodlabs-wallet-stability-verify; fresh AstraHigh final source review required. No worker spawning or production actions. One writer per worktree. Native bindings specified; effective runtime and usage telemetry UNKNOWN.

## Reproductions and design preflight

Stateful actual-module real-ethers RPC loop: wallet0.003ETH,100k buy actual gas,130k padded,3.5gwei cap buys0.002495ETH and leaves0.000155ETH. After validated mined buy,50k approval requires0.000175ETH before padding/floor; Max Sell blocks. Same-storage mined buy also remains locally pending until receipt refresh. Red tests/node-trade-roundtrip.test.js in critical tree.

Actual NodeTrading browser with5nodes: Buy Max All creates fivepending records; after receipts confirm and focus/visibility fire, refreshCalls0,snapshotCalls1,confirmedCount0,manualRefreshAll count0. Following sell blocked by stale pending state. Independently, review focus/scroll moves viewport1082to3857 without navigation or page error. User-device navigation/root cause remains unconfirmed. Red tests/node-trading-status-browser.cjs in UI tree.

Real-provider50-node delayedRPC at200ms/request: preparation31.172s,total61.595s,50ready but24sent before old shared60-second expiry;2099requests. This requires a bounded intent lifetime and fresh per-node reviews rather than allowing old quotes to execute.

## Financial invariants and approved changes

Existing direct signed contract submission remains. Preserve explicit chain/runtime/token/route checks,nonce/balance/gas/simulation,2percent slippage,verified vault ownership,one-use reviews,per-node browser locks,durable recovery before one broadcast,unknown failclosed,ordered sends and stop on error/unknown/cancel. No signing/key format changes,fee increases,looser slippage,automatic approval-to-sale continuation or transaction write pipelining.

Max percentage buy retains futureReserve = GAS_FLOOR + current padded buy gas * reviewed fee cap *3 for curve or*4 for v4. This budgets one current padded-buy unit per approval and two for sale plus existing floor. Current buy gas is also reserved. Recompute monotonically during gas refinement; enforce reserve again before signing; expose it in review/UX. Verified envelope includes buy100k,each approval50k,sell200k at unchanged3.5gwei. Future quotes still fail closed on higher actual costs; no guarantee of all future fees. Existing underfunded wallets need ETH; refresh cannot create it. Custom exact amounts keep their explicit semantics.

All-node intent deadline5minutes from preparation start. Each trade review retains its60-second lifetime. Before each unsubmitted node, a review near expiry may be prepared once again and executed immediately. Revalidated review must preserve node/token/route/side/action/percent/exact input/spender,retain at least original minimum output,and not increase original gas/total-cost or fee/priority ceilings. Permit2 expiry retains same exact amount/spender and existing fresh relative approval lifetime. Never reuse an expired review or change approval into sale. Overall expiry,selection/session change,cancel,price/cost/input guard failure,unknown or error stops later writes. One-use batch consumed before first await. Initial preparation may outlive early individual reviews but not overall intent; renewal before execution is mandatory.

## Refresh and user experience

One coalesced read-only transaction refresh cycle,concurrency at most3. Observe pending/unknown hashes,verify through existing receipt checks,retain exact-hash/session/token fences,never overwrite a newer operation. Never increment writegeneration,cancel active submissions,or occupy their action lock. Prompt first check after submission,visible-page polling with no overlap,focus/visibility coalescing,cleanup on session/token change/unmount. Pending/unknown stays blocked until verified. Prefer observing already-submitted nodes while a batch continues. Bound queued work; pause hidden polling and recover on return.

Refresh holdings once after terminal transitions or manual Refresh All. Keep last good holdings on transient read failure; report partial failures and last-update state. Manual Refresh All covers every recorded wallet-node operation and current token/native balances,joins an existing refresh instead of duplicating it,and never submits a transaction. Synchronize displayed row,batch and single-action outcomes by matching hash. Preserve previous-token operation recovery for same wallet.

Optional internal bridge: NodeTrading onNodeBalancesRefresh callback increments WalletWorkspace nodeBalanceRefreshVersion; NodeManager balanceRefreshVersion invokes existing read-only balance load under current finance/session/target guards. No account capability or vault ownership changes. Remove forced review focus/scroll; concise live progress replaces page jumps. Approval-only actions must clearly explain their confirmation and next explicit sale step. Max copy explains ETH retained for approval and sale gas.

## Acceptance and release

Original red stateful roundtrip and browser paths pass. Exercise curve/v4 Max buy→mined+verified→approval(s)→sale with persistent balances/allowances/storage; insufficient funding and fee/price changes fail before signing.50-node delayed execution completes when bounds hold; expired/changed/canceled/unknown actions cannot renew into unsafe sends. Exercise presets/custom/approval-only preservation and duplicate clicks.

Independent browser: auto completion and holdings,manualall,partial RPC failure,unknown/reverted,focus/visibility bursts,hidden pause,newer hash,session/token replacement,background reads during writes,no navigation or forced scroll. Genuine logout,identity/capability change,pagehide and idle revocation remain failclosed. Investigate actual auth refresh behavior but do not relax it without new preflight and reproduction.

Freeze combined candidate; fulltests,typecheck,production build,release scanner,moderate audit and dedicated browsers; independent behavioral verification; fresh actual-source AstraHigh review; exact-head hostedCI; clean-source Vercel deployment and live acceptance. Preserve flags/domains,separate hoodrich/www deployment. Prior Ready rollback dpl_GtqD6LP9Bu9KEgzBs9XBhZ5q9wkR,hoodlabs-abc3m6pxh-tx-build.vercel.app. No new production effects beyond authorized Hoodlabs release.
