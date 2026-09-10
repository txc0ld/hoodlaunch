# Completed-subscription rejoin contract

Base: 04da3c7d86a91120cbe428595e6028197bd63517. R2 bounded repair; owner is the designated critical builder in `hardening/repairs`. Allowed paths: public-checkout helper, new-project SQL, focused checkout/SQL tests and this contract. No payment, cancellation, deployment, owner credentials or unrelated UI changes.

A fresh authenticated Checkout Session must identify the exact subscription. A fresh subscription read must match that ID, stored customer, exactly one configured price and quantity one. Only `status === 'canceled'` can permit another checkout. Stripe documents that canceled subscriptions cannot reactivate; scheduled cancellation remains active and does not qualify. The immutable subscription ID binds to the current checkout key and session. Rotation compares key/session/subscription atomically; a delayed concurrent loser reads the winning reservation. A failed binding, uncertain response, configuration mismatch or absent ID never creates a new checkout. Existing fixed expiry, exact request replay, portal prerequisite and unknown-session barriers remain.

Acceptance: canceled → one new session; delayed concurrent requests → one winning key; active/scheduled cancellation/past_due/unpaid/incomplete/absent or wrong identity/price/quantity/transport errors → portal or reconciliation without create; binding and stale CAS failures → no extra session; missing portal configuration → no reservation/create. Node24 focused SQL/helper tests, typecheck, independent verification and fresh review bind to the exact candidate. No real Stripe operations.

Source: [Stripe cancellation lifecycle](https://docs.stripe.com/billing/subscriptions/cancel), [retrieve subscription](https://docs.stripe.com/api/subscriptions/retrieve). Existing subscriptions created outside this application's controlled checkout flow remain an operator reconciliation concern; this slice does not manage or cancel them.

Key principle: a verified terminal subscription may open one new checkout generation; age or uncertainty cannot.
