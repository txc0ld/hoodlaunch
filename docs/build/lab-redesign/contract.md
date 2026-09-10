# HOODLABS laboratory release contract

Base: `b2e2ba722ccacff48987e6aa401bc035d5377f12` (clean).

## Scope and owners
1. Sol feature builder: science laboratory visual redesign, accessible motion, responsive workspace and guide styles. Presentation changes only; original handlers and wallet session lifetime remain intact.
2. Sol feature builder: local Token Lab. Free allocation, FDV and fee planning; Pro vesting scenarios, comparisons and exports. No contract changes or promised returns.
3. Astra critical builder: custom PONS quote asset launch, approval/economics reads, prepare/send/recovery binding and PairSelector. Non-native initial developer buys are rejected; no ERC20 approvals or generalized trading added. Existing ETH node trading rejects unsupported custom pairs.
4. Root: generated artwork, shared integration, release verification and deployment.

## Invariants
- Owner `.env.local`, personal exchange credentials and private keys never enter public source, built assets, tool output or hosted environment.
- Existing native ETH launches and journal recovery remain backward compatible; reviewed transaction bounds, identity, chain, runtime fingerprints and economic freshness remain enforced.
- New custom pair must be approved by the pinned factory, with validated decimals and denomination. Pair identity/economics bind simulation, final send and receipt recovery. ETH pays launch fee and gas. No allowance or token transfer is introduced.
- Existing Pro authority, revocation, node unmount/forget, recovery journal and disabled-live gate remain intact.
- Laboratory motion has a pause control and respects reduced motion. All tools work by keyboard and at phone widths; no fake telemetry or live-market numbers.
- Token Lab plans are illustrative local calculations, explicitly independent of PONS fixed supply/curve contract terms.

## Acceptance
Unit tests and TypeScript build; independent failure-case verification of custom pairs and calculator inputs; actual compiled-page keyboard/mobile/motion checks; public-secret scan and existing core regression suite. Freeze commit and fresh Astra release review. Validate protected hosted deployment against exact source revision.

## Risks
| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Custom asset approval/economics changes between review and send | Medium | Re-read approvedPairTokens, pairTokenEconomics and economic commitment immediately before signing; invalidate review |
| Non-native denomination interpreted as ETH | Medium | Explicit quote label, decimals, separate ETH fees; reject custom initial buys and ETH-only node trades |
| Visual reorganization loses wallet session/recovery | Medium | Keep mount condition and handlers unchanged; inspect exact diff and regression-test |
| Planning output mistaken for deployed tokenomics | Medium | Explicit simulation labels; no automatic launch-form writes |
| Motion hampers accessibility or performance | Medium | Transform/opacity, reduced-motion, pause, optimized single hero asset |

Key principle: make experimentation expressive while keeping every financial action explicit and verifiable.
