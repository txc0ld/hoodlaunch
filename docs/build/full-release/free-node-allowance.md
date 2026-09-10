# Free generation allowance backend

R2 backend only, base e71bcfcd12ebe6b3226cc674ff6cf90fe8c07469. Adds service-only migration004 and authenticated node-generation status/reserve API. One free generation attempt per rolling24hours, bulk1–50 only after current server Pro verification. SQL locks account/session, retains immutable per-account request IDs and counts, denies new free requests during cooldown and rechecks session expiry before commit. Requests contain only action/requestId/count; no wallet secrets or backups are accepted. NODE_GENERATION_ENABLED defaults false and remains disabled.

Before use: independently verify migration on real PostgreSQL with multiple connections, API origin/auth/entitlement/failure boundaries, then implement separately reviewed vault-only UI, same-key backup retry and session lifecycle invalidation. Account sign-in must work. Restore does not use this allowance. A generation reservation is not a backup-save acknowledgement and cannot recover browser keys after a crash. Do not enable funding/trading/bridging as a side effect.

Root implements in an isolated worktree under the documented agent-capacity exception; no production migration, capability enablement, private-key handling or financial transactions are part of this backend slice. Independent verification and fresh review required. Evidence outside published source in verification/full-release/free-node-allowance.

Key principle: atomic account allowances, client-owned keys, recoverable retries.
