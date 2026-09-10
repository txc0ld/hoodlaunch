# WalletConnect / cross-device connection

Base fbf2910c18f0b948df376f67312f3ae39d0fa3a2, clean and deployed protected preview. Next16.3.4/React19/ethers5.8/Node24. User supplied public Reown project ID 0e803d31ef389e7919f9b890413473e2 and requested mobile Safari/MetaMask and broad device support. Existing MetaMask-browser fallback is deployed; this slice adds real WalletConnect session transport and wallet selection.

## Risk and ownership
R3: selecting the EIP-1193 provider used by launch signing and holder proof is a critical authority boundary. Root Astra owns design, integration, external config, evidence and release decision. One critical-builder owns implementation and package lock. Independent verification and fresh Astra review required. No production financial enablement or real signature/fund transfer is authorized by this slice. Protected-preview deployment is authorized by standing instructions; a qualified human financial release remains separate.

## Scope
- Pin @reown/appkit and @reown/appkit-adapter-ethers5 to1.8.23 (registry verified). Keep ethers5.8.0 and current Next/React. Lazy client-only SDK initialization, singleton per browser. Explicit Connect opens EVM wallet selector with WalletConnect mobile links/desktop QR and injected/EIP6963 options. Clear cancel/error/retry/disconnect UX, no hanging Connect state.
- Configure public NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID through hosting. Do not use or copy owner .env.local. If config is absent or SDK fails, retain the existing injected/MetaMask-browser fallback and explain availability. No automatic app opening, pairing approval or signing on render.
- Networks: Robinhood Chain4663 nativeETH with existing trusted RPC/explorer, plus Ethereum1 for existing wallets. Unsupported/wrong chain must remain non-launchable. Switching uses selected provider and existing reviewed network metadata; no funds moved by Connect.
- Single shared lightweight provider registry consumed by pons.ts and ProAccess/holder flow; SDK heavy import stays out of crypto/core modules and server rendering. Do not overwrite window.ethereum. Preserve existing injected-only behavior before an explicit connector choice. After explicit selection/disconnect do not silently substitute another injected account/provider.
- Integrate UI for Connect/disconnect and holder verification so WalletConnect also works for the connected-wallet proof flow. Do not change proof messages, nonce/session checks, eligibility rules, trade/bridge signing or generated-node custody.
- Disable unrelated SDK email/social/embedded wallets, swaps/send/onramp and analytics features. Maintain HOODLABS theme and accessible mobile dialog/QR.
- CSP additions limited to observed required official Reown/WalletConnect HTTPS/WSS/frame origins. Keep nonce/strict-dynamic/no unsafe-eval/default-src self/frame-ancestors none. No wildcard connect-src or arbitrary RPC/proxy endpoints. Existing img-src HTTPS remains.

## Invariants
1. Selecting a wallet never signs, approves, withdraws or broadcasts. Account/chain read/permission requests are allowed only at relevant user actions; saved-session discovery does not prompt.
2. Active provider identity is stable and authoritative. Replacement, disconnect, account or chain change invalidates stale UI/reviews and holder operations. Clean up listeners on rebind/unmount; no duplicate handlers. Old callbacks/results must not overwrite a newer connection.
3. Launch preparations remain bound to the exact selected provider/account/chain/runtime. Existing assertWallet checks before signing remain intact. Session disconnect cannot fall back to an unrelated injected signer.
4. Holder proof uses the same selected provider and keeps existing session/generation/account/chain/message checks. No client-proclaimed Pro state or changed verification origin.
5. No wallet private keys or generated-node secrets are sent to Reown/HOODLABS servers. WC session pairing data is sensitive: do not log/commit URIs, session topics, relay authorization or credentials. Public project ID is not a secret.
6. No downgrade of existing live-launch flags, authentication protection, server secret handling, exact USD15 price or666666 RICH threshold.

## Acceptance
- Deterministic independent negatives: provider selection/replacement/disconnect, no fallback after selection, stale asynchronous callbacks, listener cleanup/duplicates, cancel/failure/retry, wrong chain and holder/launch provider binding.
- Existing full tests/typecheck/build/release/owner scans. Audit changed dependency tree; moderate/high/critical unresolved advisories block release unless repaired within compatible versions. No blind dependency override.
- Actual SDK browser (desktop QR + mobile wallet selector) with supplied public projectID and real Reown relay/API requests; CSP enforced. Inspect wallet list/QR/modal closure and bounded errors. Mask/omit pairing URI and wallet session data in artifacts. Browser emulation does not prove physical iPhone wallet approval; report that boundary.
- Exact candidate independent verification, fresh review, GitHub CI, protected deployment, canonical domain SDK+HTTP/browser validation, temporary bypass revoked. User can approve a physical connect on their own device; do not issue transactions or fabricate that proof.

Key principle: transport may change, but the selected wallet remains the sole signing authority.
