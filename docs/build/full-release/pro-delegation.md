# Pro ownership proof for EIP-7702 wallets

Base: `2f798af318d646ae1e6b29822589b8735d65c8f1`.

A wallet with an EIP-7702 delegation was rejected by the holder verification code even though it retains its original key's signature authority. The holder reader now accepts empty account code or exactly the 23-byte `0xef0100 || nonzero 20-byte address` designator described by [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702). Equivalent hexadecimal letter casing is accepted. Ordinary contract code, zero targets, malformed types or hex, truncation, extra bytes and trailing whitespace remain rejected.

## Invariants and threat assumptions

- Account code is untrusted RPC data. A private classifier checks type, exact character length, marker, hexadecimal characters and nonzero target; it does not inspect, trust or execute the delegated contract.
- A delegation is not an entitlement. The existing 65-byte personal-sign proof must still recover the original account address and match the current user, session, domain, chain, nonce, challenge and expiry. A delegate key cannot prove ownership of the original account.
- Existing atomic challenge consumption, replay protection, confirmed-block token balance and decimals checks, canonical block checks, chain checks and fresh context rereads are unchanged. RPC, database and revocation failures remain closed.
- Pro still requires verified ownership plus the existing token threshold or explicit server grant, or the separate subscription path. Imported wallet state, custody, signing, generation quotas, transaction gates and public provider settings are unchanged.
- No actual account signatures, delegation writes, user keystores, passwords, funds or production secrets were used in implementation or tests.

## Builder verification

The unchanged holder suite passed 25/25. New tests ran first against the old guard: three of four cases failed, including the valid designator with `HOLDER_EOA`. After the minimal guard change, the holder suite passed 29/29; related holder-client, wallet-grant and sign-in suites passed 45/45. TypeScript `tsc --noEmit` and `git diff --check` both exited 0. These cases use actual ethers ECDSA signatures from public inert fixtures and the existing PGlite SQL lane, with mocked read-only chain responses.

Added coverage includes exact threshold behavior, grant denial before proof, original-key proof with a delegate address belonging to another fixture key, rejection of the delegate's signature, wrong user/session/domain/chain/message, atomic concurrent consume and replay, malformed code both before proof and after a grant, RPC/database failures, expiry and session or holder revocation during reads.

Detailed command output and final candidate binding are under the external verification artifact directory `verification/full-release/pro-delegation/builder`. Independent verification, fresh review, full build/release checks and live user activation are owned by the integration/release lead; builder test results are not production acceptance or a custody audit.

## Recovery and rollback

No migration or persistent data change is required. Reverting this code commit restores the previous guard and therefore makes delegated-wallet holder proof unavailable again. Existing wallet backups and imported identities are untouched. Users retain their original unlocked recovery tab and encrypted files until recovery is confirmed. Following release, a granted wallet's owner must complete Verify holding wallet locally; agents cannot activate their ownership proof on their behalf.
