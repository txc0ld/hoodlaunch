# Signed-in Free image uploads

R2 backend slice on base `d3b64225ff4123f06b3dd8283c8d19f3bdb6e017`. Managed image uploads now authenticate an existing account session and use current server entitlement state only to select the 86400-second fixed-window limit. Holder proof is not required for Free uploads, and billing or holder-status failure falls back to the Free budget.

## Admission and failure behavior

| Boundary | Enforced behavior |
|---|---|
| Account identity | Existing opaque server session cookie and database account lookup; client user or Pro claims are ignored |
| Entitlement read | Existing `getProStatus(userId, digest(cookie))`, bounded by `pro-check:<user>` at 120 per fixed 3600-second window; errors fall back to Free |
| Account window | Existing `upload:<user>` bucket, 5 attempts for Free or 50 for verified Pro per fixed 86400-second window anchored by its first admitted attempt |
| Global burst | New `upload-burst-global` bucket, 30 attempts per fixed 60-second window anchored by its first admitted attempt |
| Global window | Existing `upload-global` bucket, 1000 attempts per fixed 86400-second window anchored by its first admitted attempt |
| Image input | Exact PNG/JPEG/WebP content type, matching decoded format, at most 4 MiB, 16 million input pixels, still image, five-second Sharp timeout |
| Normalized output | Auto-oriented, at most 1024 by 1024, WebP quality 85, metadata removed, at most 1 MiB |
| Provider | One request to fixed `https://uploads.pinata.cloud/v3/files`, server-only JWT, 15-second abort signal, redirects rejected, response capped at 32 KiB, structurally valid CID required |

Upload admission is account window, global burst, then global window. Invalid MIME and missing provider setup fail before admission. All three reservations happen before request-body reading, decoding, or Pinata. An admission denial or later body/decoder/output/provider failure does not refund a slot. The route never retries Pinata. Network, timeout, HTTP and stream failures return a bounded storage-unavailable error; malformed, nullable or oversized provider responses return a bounded invalid-response error. A normalized image over 1 MiB returns `IMAGE_OUTPUT` with advice to choose a simpler or smaller image.

The existing quota RPC resets a bucket only when its stored `expires_at` is reached; it is not a sliding or rolling-window counter. Consequently, consecutive fixed windows can produce boundary bursts. The 1 MiB output limit bounds accepted storage to at most 1000 MiB inside one `upload-global` window, but it does not establish a 1000 MiB cap across every arbitrary 24-hour interval.

## Verification

The original route was reproduced returning 403 to a valid signed-in Free fixture before the gate change. Node 24.19.0 verification then passed the focused upload/public-service lane 26/26, the complete repository suite 413/413, TypeScript, the Next 16.3.4 production build, `git diff --check`, and the release scanner. The scanner observed 182 staged/tracked files and 105 browser artifacts with zero private/generated tracked paths, client credential references, or client source maps.

Real Sharp tests cover MIME/magic mismatch, disguised SVG, animated WebP, input bytes, decoded pixels, metadata stripping, dimensions, WebP output and the 1 MiB result cap. PGlite executes the existing `hood_take_quota` function to prove concurrent reuse of a pre-existing `upload:<user>` counter and atomic global-burst denial before downstream work. Provider fixtures cover the fixed URL, request form, JWT placement, timeout signal, HTTP/network/stream failures, missing/malformed/nullable/oversized bodies and invalid CIDs with exactly one attempted request.

Full logs are outside published source under `verification/full-release/simple-launch/upload/`. Authenticated hosted upload QA, production Pinata writes, production database access and deployment remain not run in this builder slice. The earlier denied production-auth adapter was not bypassed. No real JWT, user file, wallet, signature, transaction, charge, migration or remote write was used.

## Risks and recovery

| Risk | Likelihood | Mitigation |
|---|---|---|
| Free access increases provider cost | High | Signed-in identity, durable fixed-window 5/50 account budgets, 30/60-second burst, 1000/86400-second global budget and 1 MiB stored output |
| Entitlement outage grants Pro budget | Low | Errors and unavailable status select the 5-attempt account window only |
| Concurrency exceeds a cap | Low | Existing service-only atomic PostgreSQL RPC; concurrent PGlite coverage at reused and burst buckets |
| Malformed media reaches public storage | Low | Strict MIME/magic, still/pixel/time checks, normalization and a second output-size check before provider call |
| Provider ambiguity causes duplicate uploads | Low | One bounded request with no automatic retry; failures consume admission |

Rollback is code-only and requires no data change. Reverting this slice restores the previous Pro-only route. Existing `upload:<user>` and `upload-global` rows remain valid across rollout or rollback; the additional burst row expires normally under the existing quota table lifecycle.
