# Current checkpoint

Updated 2026-09-12T23:49:17.909109+00:00

Request: faster Hoodlabs wallet-node buys and repair Sell All Nodes appearing to refresh and log out the wallet. The original HOODRXCH directory is a different project and was not changed. Actual application source is txc0ld/hoodlaunch; local and remote main both match 87e1be50a918f145f6b5015c4138c88558f20856.

Main candidate worktree: /home/tx/projects/hoodlabs-buy-speed, branch perf/wallet-node-buy-speed. Original checkout clean. Application source remains unchanged pending reproducible diagnosis.

Contract: contract.md. Root Astra High is the designated critical owner for the fixed-RPC provider slice. Independent verifier Sol High works in /home/tx/projects/hoodlabs-buy-speed-verify. R2 session bug owner Sol High works in /home/tx/projects/hoodlabs-sell-session and must receive root design approval before source changes. Fresh independent Astra High final review required.

PASS: npm ci exit0 on Node24.21.0; existing trade31/31 and batch9/9 baseline tests independently; remote main identity. Provider HTTP microbenchmark records23 vs12 requests,607ms vs319ms at25ms injected per response. This is not live trade throughput. Artifacts: artifacts/wallet-node-buy-speed/provider-roundtrips.json and install.log.

Pending: full-trade provider regression, actual Sell All/session reproduction, approved fixes, candidate checks, review and integration into original checkout. No live keys, user backups, funded transaction or production deployment authorized or used. No standing deployment authorization inferred from old files. Model token/cost telemetry UNKNOWN.

Provider slice implemented. Root trade/batch40/40, full422/422 and typecheck pass. Independent full real-provider regression10/10 passes:69 to55 RPC requests per complete fixture buy,18 to4 chain-ID requests; sample baseline239-277ms/candidate168-191ms at5ms response delay. Explicit safety checks unchanged. Independent full432/432, typecheck and build pass. Root copied the independent regression into the candidate.

Sell-session root cause is not confirmed on the user device. Browser repro verifies transient background account status failure clears identity and unmounts the wallet workspace; plain Sell All click does not navigate or lock. Root approved one read-only status retry within the original20-second deadline, preserving all final failure/revocation behavior. Sol High owner is implementing in isolated sell-session tree.

Dependency audit exit0 at moderate threshold,15 inherited low-severity advisories. Lockfile unchanged. Owner: repository maintainer; disposition: separate dependency-review work, no dependency changes in this bug fix. Native verifier tool and local role config both bind Sol High; runtime token/model/effort telemetry unavailable. Generic inherited model prose is not treated as runtime telemetry.
