# Wallet account sign-in — R2 contract

Base:436d45114ba031fc673852483da2628d2bd670e0. Scope: remove the custom-SMTP prerequisite using native Supabase Ethereum Web3 authentication, preserving opaque application sessions and all current entitlement boundaries. Root is the sole isolated implementation owner under the recorded agent-capacity exception. Independent verification and fresh review remain required.

- Fixed canonical-origin SIWE message, chain4663, checksummed address, nonce, request ID and five-minute expiration. Recover ECDSA signer before one native verification call. Verify native provider/address/chain/network/domain and user/session/identity UUID consistency. No EIP1271 or private-key handling.
- Common email/wallet begin→claim/verify→finish lifecycle, serialized with logout. Starting a new attempt revokes previous sessions issued for the same binding, including completed attempts whose HTTP responses are delayed. Provider calls happen outside database locks.
- Cancellation by unguessable request ID only revokes that attempt. Missing IDs create tombstones before a delayed begin can arrive. Begin request timestamps are bounded; revocation records persist24 hours, beyond one-hour issued sessions. Cancellation never clears an unrelated browser cookie.
- Stable HttpOnly binding; malformed/duplicate cookies fail. Native tokens stay server-side. Existing account users, holder links, subscriptions and Pro logic are not migrated or merged.
- Per-ID browser cancellation markers contain no signature, message, token or key. Account adoption checks markers synchronously. Unknown cancellation persists through remount and keeps account tools locked. Abort/keepalive is never treated as cancellation proof.
- `WALLET_SIGNIN_ENABLED` defaults closed. `NODE_GENERATION_ENABLED` and `LIVE_LAUNCH_ENABLED` remain closed during this slice. Actual native-provider, database concurrency/RLS, client cancellation and device acceptance must be reported separately.

Acceptance evidence is kept outside the release source tree in the existing protected verification location. Source/build scans must show no owner credentials or wallet material. Model review does not replace a qualified custody release decision.

Key principle: the server revokes stale account authority; hiding a late browser response is insufficient.
