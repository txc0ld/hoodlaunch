# Elegant HOODLABS redesign contract

Base: 67022aeac796e1299475e87f60bd56405fdbc967. Risk R1 presentation and scroll behavior; no financial/auth behavior edits. User explicitly authorizes a complete elegant minimal redesign using their CloudFront video and scroll animations.

## Design
- Reference viewed: 10.04-second1920x1080black video, slow icyblue bloom, small particles and fine silver lines. Selfhost the supplied asset; no thirdparty tracking/mediahost dependency.
- Tokens: background #050608; panels #0e1117/#12161d; border #28313c; white #f4f7fa; muted #aab4c0; ice accent #b9ddf4. Space Grotesk, regular/mediumweight; remove graffiti/Anton usage from UI.
- Hero: generous central type, actual atmospheric video, thin rules, two clear CTAs. Scroll-driven depth/reveal and chapterprogress with native scrolling; no scroll hijacking.
- Workspace: readable labels, consistent10–20pxrounding, subtle borders; avoid fake data/status and decorative jargon. Guides: short sections, accordions and clean tables.

## Ownership
Root: LabHero.tsx/module.css, globals.css, assets, any dedicated scroll component, contract and integration. Sol feature builder: component CSS for PonsLaunchpad, Guide, ProAccess, TokenLab, NodeManager, NodeTrading, NodeBridge, MobileWalletConnect, PairSelector, HolderFeeSharing only. No overlapping writers; no dependency or lockfile change intended.

## Invariants and checks
Preserve all input IDs, labels, handlers, modal behavior, session boundaries, backups, peraccount24h allowance, Pro rules, slippage max2percent, PONS nativeApply/bottomsimulations and feature gates. Video silent/playsinline, pause offscreen/background, reducedmotion usesstaticposter; explicit motiontoggle, mobile lowcostmode. Content must remain readable with noJS, keyboard or deniedautoplay. Test375/768/1024/1440, focusnavigation, reducedmotion, actual wheelprogress, missingasset/autoplayrefusal, form/pair/Planning/authcancel unaffected. Run380tests/types/build/scans, independent behavior/visualreview, CI/deploy/publicchecks bound exactcandidate. No real funds or signing in design tests.

Key principle: movement adds depth; it never obstructs using the tools.

User refinement: video must loop seamlessly. Encode a cyclic tail/head blend; verify decoded boundary and actualbrowserloop; use matchingfirstframeposter. Root also owns favicon and homepageOGimagepointer for visual consistency.
