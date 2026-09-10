# Mobile wallet entry fix
Base b8e26d1c9836e60da9c50ad2aa725b54f521bd58, clean. Next16/React19/ethers5, no WalletConnect SDK. R1 browser entry navigation; no signing/provider/session implementation changes.

Reproduced twice: connectWallet without window.ethereum rejects No browser wallet found. Adding an injected provider permits eth_requestAccounts/eth_chainId and returns wallet state. Missing provider is the confirmed defect for ordinary mobile browsers; specific user device/wallet clarification pending.

Scope: when Connect finds no callable injected request, show an accessible wallet-app chooser with official MetaMask and Trust Wallet dapp-browser links, canonical https://labs.hoodrich.rip/ only. Offer copy/manual site URL and retry injected provider detection. Explain opening wallet starts a separate workspace; unsaved drafts and generated wallets are not transferred; protected preview may require sign-in there. Existing injected connection goes directly through unchanged connectWallet. No automatic navigation, pairing, wallet requests, chain changes, signatures or transactions on render. No URL query/hash/auth/secret material forwarded. Native dialog focus/escape/close and >=44px touch controls, 375px width.

Owned implementation paths: new src/components/MobileWalletConnect.tsx + module CSS; new src/lib/mobile-wallet.ts; PonsLaunchpad.tsx only connect entry and modal mount; tests/mobile-wallet.test.js; pages/guide.tsx brief mobile connection instructions. No changes to pons.ts, holder signing, sessions, RPC, CSP, packages/lockfile, Pro/launch flags. Root owns contract/integration/private browser evidence. One serialized builder in root repo.

Acceptance: regression proof of no-provider chooser and valid native links; no URL secret forwarding; existing injected mock account connection and rejection/reset/retry; mobile geometry, keyboard focus/escape/return, clipboard failure/manual fallback. Full tests/typecheck/build/release/owner scan, fresh review, exact CI, protected deployment and hosted browser. Physical iOS/Android app handoff cannot be claimed unless observed; record limitation and user device answer. No live signatures/funds or SSO relaxation.

Official references: https://metamask.github.io/metamask-deeplinks/ (bundle.js uses https://metamask.app.link/dapp/ + HTTPS-stripped URL); https://github.com/trustwallet/developer/blob/master/develop-for-trust/deeplinking/deeplinking.md (https://link.trustwallet.com/open_url?coin_id=60&url=encoded HTTPS URL); https://support.metamask.io/configure/wallet/how-to-use-the-metamask-mobile-browser/ .

Key principle: give mobile visitors a clear route into a wallet browser without changing transaction authority.
