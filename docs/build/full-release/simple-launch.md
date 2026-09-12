# Simple launch UI checkpoint

Status: implementation candidate. Base: `d3b64225ff4123f06b3dd8283c8d19f3bdb6e017`. Branch: `feat/simple-launch-ui`. Owner: UI slice only. Root owns integration, compiled visual verification, full-suite verification, final review, and release.

## Scope and invariants

The page now follows Account → Create → Wallets. `ProAccess` remains outside the keyed `WalletWorkspace`; launch renders before the generator inside it; the existing ownership/capability key and `useLayoutEffect` signing-session invalidation are unchanged. The generic Token Lab simulator is no longer rendered. The supported `PonsLaunchPlan` remains under advanced launch settings.

Signed-in Free and Pro sessions see the managed uploader. Guests see its requirements and can use an existing public URI. Selection, replacement, removal, logout, and account change increment or invalidate the upload generation, abort the active request, revoke the object URL, and reject a completion whose captured session no longer matches. The server remains the upload identity, quota, and entitlement authority.

Trading calculations, approval flow, batch execution, action locks, slippage, gas reserve, and recovery functions were not changed. Large per-node transaction metadata is collapsed under Details while status, messages, and pending/unknown recovery actions remain visible.

## Evidence

- Base failure: `verification/full-release/simple-launch/ui/red-simple-launch-ui.log` — 0/2; account rendered after create and Free upload was absent.
- Targeted source tests: `verification/full-release/simple-launch/ui/targeted-tests.log`.
- TypeScript: `verification/full-release/simple-launch/ui/typecheck.log`.
- Upload browser test: `verification/full-release/simple-launch/ui/upload-session-browser.log` — PASS in Edge for account change, replacement, removal, and a newer invalid selection while the prior request is held.

## Risks

| Risk | Likelihood | Mitigation |
|---|---:|---|
| Late upload result crosses account sessions | Low | Captured session plus request generation check; abort and object-URL cleanup |
| Disclosure hides a required recovery state | Low | Pending/unknown/approval status and recovery actions remain outside transaction Details |
| Wallet state is lost during workflow reorder | Low | Original keyed ownership boundary and layout-effect invalidation retained; existing lifetime tests |
| Responsive dense rows overflow | Medium | Compact desktop grid and existing mobile collapse; root compiled visual gate at required viewports |

Key Principle: simplify the visible path while leaving account authority and signing-session fences intact.
