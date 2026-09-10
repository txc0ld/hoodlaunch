# WalletConnect implementation record

Contract: `contract.md`. Implementation base: c120f6ef6cf424dabe09988a0cb1847069d5132d. Critical implementation owner: designated Astra High builder. Independent verification, fresh review, protected deployment and real SDK browser evidence belong to the orchestrator; this record is not a release approval. Model token usage is unavailable (unknown).

## Authority and lifecycle

`wallet-provider.ts` is the sole lightweight provider registry. Before the first explicit choice, legacy injected read-only discovery remains available. Beginning a choice or disconnecting fences fallback for the rest of the page lifetime. Confirming a choice consumes its ticket. Provider listeners are bound once, removed on replacement/last subscriber cleanup, and reject queued callbacks from removed bindings. Every provider event advances an authority version. No code overwrites `window.ethereum`.

`walletconnect-sdk.ts` loads only after an explicit Connect action. AppKit 1.8.23 / ethers5 adapter 1.8.23 are pinned. UniversalProvider 2.23.7 is the same version required by AppKit and is a direct pinned dependency so transport telemetry is explicitly disabled and its logger is silent. Reconnection, analytics, embedded/email/social wallets, Coinbase/Base SDK connectors, send/swap/onramp, history, pay, smart sessions and Reown authentication are disabled. Ethereum 1 is the initial pairing network; Robinhood Chain 4663 uses the existing PONS RPC/explorer. Unsupported networks remain non-launchable.

SDK callbacks can propose a provider or invalidate an old one, but cannot install signing authority. The local “Use this wallet” dialog displays the account and network and requires a separate user action. `wallet-connection.ts` rereads both, rejects stale tickets/events/results, and cleans temporary listeners. This also prevents a delayed SDK success from an earlier attempt from silently becoming a newly selected signer. Connect/candidate reads never sign or send. Initialization/permission reads have bounded UI deadlines; cancellation resets/aborts pairing and invalidates selection. Failed initialization clears the rejected promise for retry. If remote disconnect fails, local authority is already cleared and the UI tells the user to remove the session in their wallet.

`pons.ts` keeps existing provider/account/chain/runtime checks and additionally binds every preparation and final check to the authority version. `ProAccess.tsx` uses this same provider/version; the holder challenge and personal-sign proof rules are unchanged. On a full page reload there is no restored WalletConnect authority or retained launch preparation; a browser's injected wallet may be discovered under the existing behavior, and WalletConnect requires explicit Connect again.

## Dependency repair

Initial installation introduced high/moderate findings through optional `@base-org/account` → `@coinbase/cdp-sdk@1.55.0` → exact `axios@1.16.0`. The current CDP release still pins that vulnerable version; a normal `npm update axios` could not repair it. The orchestrator approved a narrowly scoped `@coinbase/cdp-sdk` Axios override. Registry-verified Axios 1.20.0 is installed, within the same major API, and above the advisory's patched 1.18.0 threshold. No ethers/Next/React upgrades or broad audit-force changes were made.

Advisory: https://github.com/advisories/GHSA-gcfj-64vw-6mp9 . Upstream release: https://github.com/axios/axios/releases/tag/v1.20.0 . Final audit report has 15 low findings, zero moderate/high/critical. All remaining findings propagate the existing ethers/elliptic advisory GHSA-848j-6mx2-7j84; the extra low package entry is the newly added ethers5 adapter, not a new advisory. Existing risk ownership remains with the orchestrator; no risk waiver is issued here.

## Network policy and evidence

Metadata contains `window.location.origin` only, with no query/hash/path forwarded. Public Reown project ID comes from `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`; no owner environment file is read. CSP retains nonce/strict-dynamic, no production unsafe-eval, no wildcard connect-src, frame-ancestors none. Added API/RPC/relay origins match package constants: api.web3modal.org, rpc.walletconnect.org, HTTPS/WSS relay.walletconnect.org, and verification frames at verify.walletconnect.org/com. No analytics endpoint is allowed. Existing HTTPS image policy is retained.

Official API/options/CSP references: https://docs.reown.com/appkit/javascript/core/actions , https://docs.reown.com/appkit/react/core/options , https://docs.reown.com/advanced/security/content-security-policy . Installed 1.8.23 types and implementations are authoritative (including getWalletProvider, subscribeProviders, ready, resetWalletConnectUri).

Full local logs are private artifacts at `../verification/walletconnect/implementation/`: install logs, initial/final audits, initial/final build and test logs, provider-tests.log, and final validation logs. Never store QR/pairing URI, session topics or relay authorization in evidence. Physical iPhone approval and actual SDK relay/browser behavior are independent gates, not established by these local source checks.

Rollback: revert the implementation commit and remove the public project ID to return to the browser-wallet fallback. No server secrets, live-launch flags, financial operations, migrations or generated-node custody paths change.

Key principle: connection transport can propose a wallet, but only the explicitly confirmed provider can become signing authority.
