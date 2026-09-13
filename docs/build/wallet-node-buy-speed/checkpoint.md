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

Latest user authorization: stress-test, improve, test and ship; then broaden practical wallet responsiveness across buys/sells. Production release is authorized for this Hoodlabs fix after mandatory checks and independent review. Preserve all existing deployment settings and feature flags; no real funds in testing.

Integrated session commit2d89bd9 includes88f7a99. Read-only status retry and actual Sell All browser regression pass builder checks. Independent account race testing is active. Additional critical performance owner has reproduced and removed two unnecessary HD derivations in two public trade preparations, reduced native balance reads from13 to9 requests for six nodes, and token snapshot reads from6 to4 dependency waves; final commit pending.

Release preflight: GitHub authenticated as txc0ld. Vercel project hoodlabs verified under tx-build, IDprj_31KjKSCKY4OQipMAihFMr5kWbO88, team_Cv19j0QqXXzQLspVN5SsX4Np, Node24.x. Previous Ready production deployment dpl_7GovGZvAyva7NmjuD65QgdU1FoRA, hoodlabs-l627fgkcy-tx-build.vercel.app, is rollback reference. Live-before unauthenticated browser checks pass ten route/viewport combinations, no page errors/overflow/broken app assets. SourceCI/publicdeployment remain pending final gates.

All intended source changes integrated at02d0716: provider buy optimization fefd0a3; session retry2d89bd9; wallet preparation/read optimization02d0716. Critical builder's extra slice passes8/8 new cases,106/106 relevant suite cases, typecheck and diff checks. Three reproductions now green (HD derivation count, native balance RPC count, snapshot read dependencies). Source/test freeze follows with this current contract/checkpoint. Root will run full combined suite/typecheck/build/release scanner; independent adversarial verification is active. Fresh independent review, hostedCI and deployment pending.
