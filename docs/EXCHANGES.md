# HOODLABS local exchange companion

Use the companion on your own computer to inspect an exported node-funding plan. Exchange credentials never go into HOODLABS, the browser, a funding plan or the hosted server. The CLI has no HTTP server, listens on no port and uses only Node's built-in libraries.

| Connector | Implemented behavior | Current limitation |
| --- | --- | --- |
| Kraken | Read permissions, available Ethereum method, verified address-book mapping, account withdrawal limit, fee and indicative net. Prepare one row; explicitly confirm one withdrawal with an exchange-enforced `max_fee` and exact address assertion. | Live execution defaults off pending financial release. Legacy funding endpoints remain active but are deprecated. Real accounts, regional availability and withdrawals have not been tested. |
| Binance | Signed account permissions, native ETH network/minimum/maximum/fee, address whitelist and Travel Rule questionnaire checks. | Inspection only. The documented withdrawal request has no enforceable fee ceiling. Complete withdrawals on Binance itself. |
| OKX | Signed account permissions, native ETH network/minimum/maximum/fee and funding balance checks. | Inspection only. No documented request fee ceiling or complete whitelist/Travel Rule readiness preflight. Complete withdrawals on OKX itself. |

**Only native ETH on Ethereum mainnet, chain 1, is supported.** ETH on Robinhood is a different network. An identical `0x` address does not imply exchange support for Robinhood. Once Ethereum funds arrive, use the separately reviewed bridge flow; this CLI does not bridge, trade or sign wallet transactions.

## Requirements and local keys

Use Node 24 or newer inside Linux or WSL. On Windows, open your WSL distribution and use its Linux home directory. Native Windows execution is blocked because Windows ACL protections have not been verified. Keep the journal under the Linux home, not `/mnt/c` or a shared/synced folder. The program verifies real directory ownership, private POSIX modes and excludes symbolic links.

The fixed journal directory is `~/.hoodlaunch-exchange` (0700, files 0600). `HOODLAUNCH` remains the technical environment/file prefix; the app is named HOODLABS. Do not change HOME, run multiple copies with different home directories, delete the journal or rotate state to retry a withdrawal. Dedicated API keys are recommended: another program using the same Kraken key can invalidate nonce ordering. The companion serializes its commands and persists monotonically increasing nonces before each authenticated Kraken request.

Set credentials only in the local process environment:

| Exchange | Variables |
| --- | --- |
| Kraken | `KRAKEN_API_KEY`, `KRAKEN_API_SECRET` |
| Binance | `BINANCE_API_KEY`, `BINANCE_API_SECRET` |
| OKX | `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE` |

Use a local password manager or hidden shell input; do not put values in command arguments, source files, screenshots, chat or a public `.env` file. The companion does not load `.env.local`. For example, in a private WSL shell, `read -rs KRAKEN_API_SECRET` reads a secret without echoing it; `export KRAKEN_API_SECRET` makes it available to the CLI. Close the shell or unset credentials when finished.

Kraken needs `query-funds` and `withdraw-funds`. Create and verify each Ethereum withdrawal address and its exact address-book key in Kraken first. Complete all required ownership/Travel Rule questions in the exchange. The companion never creates an address, disables MFA or changes a whitelist. API-2FA that requires an OTP is unsupported here: use the exchange's normal workflow, without disabling safeguards. Binance/OKX need read access for inspection; do not enable withdrawal permission for these read-only connectors. Existing exchange restrictions, holds and regional rules still apply. A successful read cannot guarantee a subsequent withdrawal will be accepted.

## Funding plan

Export the plan from the node-funding area. It contains only public destination addresses, requested amounts and optional Kraken address-book names. The schema is strict; private keys and unknown fields are rejected. A plan supports 1–50 consecutive, unique nodes.

```json
{
  "version": 1,
  "id": "5bf5bf52-b718-4ac5-aec1-01f367d04b39",
  "sourceChainId": 1,
  "asset": "ETH",
  "createdAt": "2026-09-10T00:00:00.000Z",
  "nodes": [
    {
      "index": 1,
      "address": "0x1212121212121212121212121212121212121212",
      "amountEth": "0.01",
      "withdrawalKey": "node-one"
    }
  ]
}
```

The example address is illustrative; use your generated node's full address and compare it with the exchange's saved destination. Amounts are exact positive decimal strings with at most 18 decimal places, never floating-point numbers. The fixed public Ethereum RPC checks chain ID and that the selected address has no code before review. This is a point-in-time check, not proof of address ownership or future behavior; preserve the encrypted node backup.

Run from the downloaded/reviewed repository root:

```sh
node companion/cli.cjs inspect kraken funding-plan.json 1
node companion/cli.cjs inspect binance funding-plan.json 1
node companion/cli.cjs inspect okx funding-plan.json 1
node companion/cli.cjs prepare kraken funding-plan.json 1 0.01
```

The last argument is your maximum account debit in ETH. Preparation performs reads and writes a local review; it never withdraws. A Kraken request of `0.01` ETH includes its fee. If the fee is `0.001`, the quoted net is `0.009`. The companion requires `net + fee = request`; unfamiliar semantics fail closed. It checks both request and net against the advertised minimum conservatively. Binance net/debit semantics are not asserted; OKX documents that its request amount excludes the fee.

Review the full address, Ethereum chain 1, address-book key, amount, maximum debit, fee and indicative net. A review expires in five minutes. There is no batch withdrawal or automatic retry.

## Execution and release boundary

**Financial release approval and independent verification remain required. No real exchange accounts or withdrawals were used during development.** Live execution is disabled unless the local process has `HOODLAUNCH_EXCHANGE_LIVE=true`. That variable is a release guard, not a subscription or custody security boundary. After release approval, the single-row command requires the exact review identifier twice:

```sh
node companion/cli.cjs execute kraken <review-id> "WITHDRAW <review-id>"
```

The CLI reloads and hashes the persisted review, verifies the same API-key fingerprint, rechecks permissions/network/address/fee/limit, enforces the debit budget, and stores an uncertainty record durably **before** the withdrawal request. It passes the exact address and `max_fee` to Kraken. Fee drift before submission requires a new review; the exchange's fee ceiling protects the remaining race. A returned reference means the exchange accepted the request, not that the node received funds. Late holds, MFA and compliance restrictions can still reject it.

## Recovery: preserve evidence, never resend on uncertainty

The companion permanently blocks automatic reuse of a recorded destination and plan row, including after successful acceptance. Changing a UUID, amount, provider or API key does not bypass that local marker. This intentionally limits the first release to one automatic funding attempt per destination. Repeat funding uses the exchange's manual workflow after independently verifying the earlier outcome.

- If a timeout, disconnect, malformed response or process crash happens around submission, treat the result as **unknown**. Do not retry, delete state, move to a second device or regenerate a plan to resend.
- For a known reference, `node companion/cli.cjs history kraken <review-id>` reads Kraken's recent history. It never clears a submission marker. A missing record or a failure label cannot by itself authorize a retry.
- Open Kraken directly, compare the full destination, amount, timestamp and reference, and contact Kraken support for an unresolved request. The journal contains public intent/reference evidence but no API secrets. Share only the records support actually needs.
- A crash may leave `process.lock`. First confirm that its recorded PID and every companion process have stopped, and preserve a copy of the whole directory in a private location. A knowledgeable local operator may then remove only the stale lock file. Keep every `intent-*`, `destination-*`, `review-*` and `nonce-*` record. There is deliberately no automatic stale-lock takeover or reset command.
- A corrupt journal, insecure directory or disk/fsync failure blocks the operation. Restore a verified private journal backup or investigate with an engineer. Do not initialize fresh state to evade it.

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Exchange rejects an account or network despite successful reads | Account dependent | Recheck before submission, exchange-enforced address/fee guards, preserve unknown state and resolve in exchange UI. |
| Process/network interruption around withdrawal | Possible | Fsynced intent before POST, no retry, permanent destination marker, reference-based read-only history. |
| Same-user malware, root access or modified CLI steals exchange credentials | Outside this CLI's protection | Dedicated restricted keys, private trusted device, IP/address restrictions where available, review downloaded source, revoke keys after use. |
| Lost/deleted journal or another device duplicates a withdrawal | Operator dependent | Preserve private journal backups and use one device/state directory; no automatic cross-device guarantee. |
| Provider API contract changes | Possible | Fail closed on unexpected shapes; independent review before updating endpoint support. |

## Sources and checks

Primary documentation reviewed for this implementation:

- [Kraken REST authentication and published signature vector](https://docs.kraken.com/exchange/guides/rest/authentication)
- [Kraken key permissions](https://docs.kraken.com/api-reference/account-data/get-api-key-info), [available withdrawal methods](https://docs.kraken.com/api-reference/funding/get-withdrawal-methods), [verified address book](https://docs.kraken.com/api-reference/funding/get-withdrawal-addresses)
- [Kraken withdrawal quote](https://docs.kraken.com/api-reference/funding/get-withdrawal-information), [withdraw request: address and max_fee](https://docs.kraken.com/api-reference/funding/withdraw-funds), [documented fee deduction example](https://support.kraken.com/articles/13307454640020-funding-via-the-api)
- [Binance capital/network/address/withdrawal API](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/capital), [API restrictions](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/account)
- [OKX authentication, currencies, account configuration and withdrawal](https://www.okx.com/docs-v5/en/)

Run `node --test tests/exchange-companion.test.js`. Tests use real HTTP requests redirected by a test-only transport to a loopback mock server, inert credentials and the published Kraken signature vector. They cover exact amounts, network/permissions/address checks, review expiry/drift, fee ceilings, redirect/timeout handling, journal/lock failure and duplicate blocking. They do not establish real-account compatibility or release approval.

Key principle: keep credentials local, review one exact withdrawal, and never turn an uncertain submission into an automatic second payment.
