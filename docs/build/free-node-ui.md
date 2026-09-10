# Free wallet vault integration

Base: bb398ee452bdcf77b3586f7ba7d8def05cc7bb69. R3 custody lifecycle plus R2 session display fencing. Root Astra critical implementation owner under existing capacity exception; independent verification and fresh review required. Public enablement remains closed pending qualified custody release decision and usable authentication.

Scope: server flag for vault-only capability, one Free generation attempt per authenticated account per rolling 24h through reviewed reservation SQL, Pro bulk1–50, backup retry/recovery, session-bound UI. No changes to financial writers, cryptography algorithms, payments or SQL migration004. No production fund operations.

Invariants: current cookie authenticates; public domain-separated session identity only fences stale UI and must match before quota. Client validates returned identity before generating keys. One UUID per uncertain request and one memory-only root per accepted attempt. Encryption/download failure retains that root for retry. Restore consumes no allowance, including50-wallet backups for former Pro. Unverified keys are subject to pagehide,15-minute inactivity and unmount locks. Keys/passwords/backup contents never enter allowance API. No financial subtree without existing Pro&&launch flags.

Account changes recognized immediately on local logout or at next60s/focus/visible refresh. Cross-tab cookie change before reservation rejected before quota. No instantaneous remote-revocation guarantee for already-unlocked browser memory. Generation limit is per verified account, not per human or a global key-generation restriction.

Acceptance: actual handler/component races and failures; real1/50 encrypted browser backup/import; Free finance-disabled DOM; session mismatch before quota; compiler/tests/build/scans; independent verification and fresh R3 review. Financial capability remains closed.
