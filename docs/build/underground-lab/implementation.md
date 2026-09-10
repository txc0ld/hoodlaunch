# Theme worker evidence

Base revision: `99077c0b804b5cd906221546907be15fa1e604c4`

## Scope

- Replaced the hero artwork with `hoodlabs-underground-lab.webp` and declared its 1254 by 1254 intrinsic dimensions.
- Reworked hero, route cards, page shell, launch form shell, Token Lab, node tools, pair selector and guides around the underground workshop design.
- Preserved launch and planning link labels, motion control labels, reduced-motion behavior, 44px controls, 16px financial inputs and the WalletConnect `.walletControls` rule.

## Observed checks

- PASS — `git diff --check`, exit 0.
- PASS — source contract check, exit 0: required hero links and motion labels present; WebP is 205452 bytes and 1254 by 1254; intrinsic image dimensions present; reduced-motion query present; WalletConnect wrapper present; no forbidden source path changed.
- PASS — CSS brace balance check across globals and all 11 component CSS modules, exit 0.
- BLOCKED — `node scripts/check-release.cjs`, exit 1: `.next/static` does not exist because this isolated theme lane was directed not to install or build.
- BLOCKED — focused Node tests `public-flow.test.js`, `token-lab.test.js`, and `public-holder.test.js`, each exit 1 before test execution because this worktree has no `node_modules` and cannot resolve `typescript`. No dependency install was attempted.
- NOT_RUN — typecheck, Next build and browser QA. The assigned root integration owner runs these against the combined exact revision.

Usage: unknown.
