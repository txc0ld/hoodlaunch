# Encrypted individual-keystore recovery

Base: `29f4157fd324ebd32e906e5699d32918b1b7c377`. Scope: `node-vault.ts`, `NodeManager.tsx` and direct tests. Root owns integration and release; this candidate requires independent verification and fresh review.

The separate **Import encrypted keystores** control accepts 1–50 individual JSON files exported by HOODLABS or the original app, each at most 2 KB and using the same password. Wallet order follows selection order. Import is local, available with signed-in Free recovery, and consumes no generation allowance. Keep every original encrypted file: imported wallets cannot be represented by an HD-root backup. Per-node encrypted export remains available with a new locally entered password.

## Invariants and threat assumptions

- Input files and progress observers are untrusted. All structural, byte-size, algorithm/cost and duplicate-address checks complete before any KDF. Inputs are copied before awaiting.
- Only exact emitted individual V3 keystores are accepted. Existing HD format, manifest checks, password validation and ethers cryptography are unchanged.
- One existing global KDF lock covers sequential decryption. Nothing is registered until every wallet authenticates and matches its declared address. Errors contain no raw crypto/file data.
- Private module state distinguishes HD roots from imported wallets. The public frozen session contains only ID, addresses and verification status. An internal index/address-checked selector serves preparation, signing and encrypted export.
- Session expiry, forgetting and existing pre/post-sign authority checks apply to both materials. The UI discards late import results after lock, pagehide or workspace unmount and preserves the current session on failure or unconfirmed replacement.
- Import performs no transaction, RPC, upload, storage or quota reservation. JavaScript garbage collection cannot guarantee physical erasure of secret strings; this existing browser custody limitation remains.

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Wrong file/password or mixed password set | Expected recoverable input error | Atomic failure; retain originals and existing session; retry exact shared password locally |
| Large or expensive malicious input | Plausible | Bounded file count/bytes and exact preflight cost before serialized KDF |
| Stale async result restores revoked authority | Security boundary | Generation/identity fences and explicit forgetting of stale results |
| Imported wallets misrepresented as HD siblings | Security boundary | Discriminated private material; fixed rejection of full HD backup encryption |

## Acceptance and recovery

Direct tests cover real five-wallet import/export, existing HD round trip, exact validation, duplicate/partial/mismatch rejection, sequential/global KDF ownership, observer resilience, snapshot ownership, mock-only signing for every HD/imported index, and pre/post-sign expiry/revocation. A fresh isolated Edge harness runs the actual NodeManager and vault with disposable files; it checks full HD recovery, ordered five-file import, replacement/failure behavior, Free allowance independence, encrypted per-node export and stale completion cleanup. It asserts no recovery network/storage/signing or secret display.

Full logs and exact-candidate metadata are stored outside the repository under `verification/full-release/backup-restore-8ce5ee2f/keystore-import/builder`. Root owns full build, release checks, independent gates and any qualified human release decision. Funded execution and real-user password decryption are NOT_RUN by the builder.

Rollback is a root-owned source revert before release or redeployment of the prior accepted revision after explicit release authorization. Original encrypted exports remain the recovery material; never regenerate wallets as a substitute or close the original working session before user-controlled recovery is verified.

Key principle: authenticated encrypted exports recover the same wallet identities without broadening their signing authority.
