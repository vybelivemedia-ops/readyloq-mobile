# ReadyLoq Phase 5 security triage

> Historical first-pass triage. The signed-upload, AI budget, authorization, and build-status paragraphs below describe the earlier baseline and are superseded by [the final-pass acceptance report](phase5-final-acceptance.md). Do not use this snapshot to infer current release readiness. Phase 5 remains **NOT ACCEPTED**.

**Status: NOT ACCEPTED. Phase 4 is deferred.** This is a code/lockfile/Development assessment, not evidence of a secure Production artifact or physical Fold 7 acceptance. The initial scan had **11 critical and 92 high** dependency records. After the targeted API dependency patches, the fresh scan has **11 critical and 90 high**; the [advisory-by-advisory CSV](phase5-advisory-triage.csv) classifies every **currently remaining** critical/high record, with package/version, vulnerability title, directness, patched version, and reachability/compatibility evidence. See the [direct-ID endpoint inventory](phase5-direct-id-matrix.md) for routes and explicit gaps. `docs/phase5-acceptance.md` records the first pass.

The classes are **P0** (before any Production release), **P1** (before unrestricted/public release), **P2** (documented mitigation or accepted residual), **DEVELOPMENT/BUILD TOOLING** (build/test-only dependency with bundle evidence), **SERVER RUNTIME**, **MOBILE RUNTIME**, **UNREACHABLE** (the exact affected copy is absent from the inspected API and Android artifacts), **FALSE POSITIVE** (technical counterexample to scanner exploit path), and **UNKNOWN** (specific missing proof). A package in a lockfile is not by itself proof of runtime inclusion. Classifying build tooling does not make malicious inputs to the build safe.

## Dependency advisories: 101 currently remaining individual records

All 11 critical records concern **Orval 8.9.1**, a *direct devDependency* of `lib/api-spec` invoked by its `codegen` script. The checked-in OpenAPI spec is the input. Neither the API's runtime dependency manifest nor the actual `artifacts/readyloq-app` mobile manifest includes Orval; existing Android export metadata/bundle scanning found no Orval package. No deployed request route executes its generator. Its generated outputs can enter applications, so a compromised/untrusted specification or CI build would change the threat model. **All 11: DEVELOPMENT/BUILD TOOLING; final Production package inventory remains unverified.** Do not upgrade without diffing generated outputs and rechecking the frozen mobile API client.

| Critical advisory | Vulnerability/input | First listed patch |
| --- | --- | --- |
| GHSA-2h9g-j24r-h63g | Array-item default injected into a generated Zod template literal; import-time code execution | 8.21.0 |
| GHSA-2w86-xfrc-g85r | Unescaped schema property name injected into generated MSW mock | 8.21.0 |
| GHSA-3575-w9fc-c2j6 | Enum default injected into generated Zod module | 8.21.0 |
| GHSA-6437-gxhq-pqv8 | Header name injected into generated Zod object key | 8.21.0 |
| GHSA-653q-5476-x79g | Query name injected into generated Zod object key | 8.21.0 |
| GHSA-6mr6-jvcr-2f25 | Schema property name injected into generated Zod object key | 8.21.0 |
| GHSA-88f2-fpv8-89q2 | `servers[].url` injected into generated request template when specification base URL option is enabled | 8.21.0 |
| GHSA-8j6p-r8jg-mxqh | Header default injected into generated Zod template literal | 8.21.0 |
| GHSA-fg9p-mrxr-hvq7 | OpenAPI path injected into generated request template literal | 8.21.0 |
| GHSA-p4cg-3328-rvfg | Query default injected into generated Zod template literal | 8.21.0 |
| GHSA-w727-8j6c-2rj4 | Schema default injected into generated Zod template literal | 8.21.0 |

High advisories by package (the CSV assigns a classification to **each** advisory, including advisories in a repeated package):

| Package / count | Class | Evidence and decision |
| --- | --- | --- |
| `@xmldom/xmldom` 0.7.13 / 51 | DEVELOPMENT/BUILD TOOLING | Seen in unrelated `readyloq-mobile` scaffold npm lock, not root pnpm lock or actual ReadyLoq app manifest. No evidence of inclusion in its Android export. Do not mistake a scanner-wide count for API or app exposure. |
| `browserslist` 4.28.2 / 2 | DEVELOPMENT/BUILD TOOLING | Transitive build/browser-target tooling, not imported by API or app source. |
| `fast-uri` 3.1.2 / 6 | DEVELOPMENT/BUILD TOOLING | Exact parents: `artifacts/readyloq-app`'s dev-only `expo-build-properties@1.0.10 → ajv@8.20.0 → fast-uri@3.1.2`, and `lib/api-spec`'s dev-only `orval@8.9.1 → @scalar/openapi-parser@0.25.12 → ajv@8.20.0 → fast-uri@3.1.2`. Absent from API and Android bundle source maps. |
| `image-size` 1.2.1 / 4 | DEVELOPMENT/BUILD TOOLING | Metro asset-dimensioning tool, not shown in app export. |
| `js-yaml` 3.15.0 / 7 | DEVELOPMENT/BUILD TOOLING | Transitive spec/config parsing; multiple versions in lock, no API or actual-app runtime import proven. |
| `linkify-it` 5.0.0 / 2 | DEVELOPMENT/BUILD TOOLING | `lib/api-spec` dev-only `orval → @orval/angular → @orval/core → typedoc@0.28.19 → markdown-it@14.1.1 → linkify-it@5.0.0`; absent from both inspected bundles. |
| `nodemailer` 9.0.5 / 1 (initial scan only) | **P1, patched in Development** | Direct API production dependency; crafted address lists could trigger quadratic parser work. Updated to 9.1.1 (advisory patch >=9.1.0); fresh scanner has no nodemailer high. Mail stream smoke passed; deployment and broader mail integration still unverified. |
| `orval` 8.9.1 / 1 | DEVELOPMENT/BUILD TOOLING | Generation-time `$ref` SSRF/file inclusion, not a deployed endpoint; first listed patch 8.22.0. Treat untrusted specifications as dangerous. |
| `postcss` 8.4.49 / 5 | DEVELOPMENT/BUILD TOOLING | CSS compilation/source-map tooling; no exposed server CSS parse endpoint established. |
| `sharp` 0.35.3 / 1 (initial scan only) | **P1, patched in Development** | Direct API production dependency; imported in image/zoom processing. Updated to 0.35.4; fresh scanner has no sharp high. JPEG decode smoke passed; Production native ABI/deployment remains unverified. |
| `tar` 7.5.19 / 1 | DEVELOPMENT/BUILD TOOLING | `artifacts/readyloq-api` and `artifacts/readyloq-app` dev-only `@expo/cli@54.0.23 → tar@7.5.19`; absent from API and Android bundle source maps. The separate `readyloq-mobile/package-lock.json` has patched `tar@7.5.21`. |
| `uuid` 3.4.0 / 1 | DEVELOPMENT/BUILD TOOLING | Both mobile Expo importers' dev-only `@expo/ngrok@4.1.3 → uuid@3.4.0`; absent from inspected API/Android bundles. |
| `uuid` 7.0.3 / 2 | DEVELOPMENT/BUILD TOOLING | App Expo CLI/config plugin `@expo/config → @expo/config-plugins@54.0.5 → xcode@3.0.1 → uuid@7.0.3`; the second scanner record is the same build-only chain in the unrelated `readyloq-mobile/package-lock.json`. Absent from inspected bundles. |
| `uuid` 9.0.1 / 1 | SERVER RUNTIME | API production graph: `@google-cloud/storage@7.21.0 → gaxios@6.7.1 → uuid@9.0.1`, and `@google-cloud/storage → retry-request@7.0.2 → teeny-request@9.0.0 → uuid@9.0.1`. The existing API bundle map includes this version. Its traced callers use `uuid.v4()` only; no vulnerable v3/v5/v6 call with a supplied buffer was found. |
| `ws` 8.20.1 / 1 | UNREACHABLE (inspected artifacts) | Root mobile graph: `@clerk/expo@3.6.2 → @clerk/clerk-js@6.22.0 → @base-org/account@2.0.1 → viem@2.53.1 → ws@8.20.1` (also `viem → isows@1.0.7 → ws@8.20.1`). The Android Hermes source map has no affected `ws@8.20.1` module; the API graph/map has only `ws@8.21.0`. Signed/released artifacts remain unverified. |
| `brace-expansion` 1.1.16 / 6 | DEVELOPMENT/BUILD TOOLING | Transitive glob/build tooling; root pnpm overrides resolve patched variants in some paths, scanner also covers unrelated locks. |

Current totals: **99 DEVELOPMENT/BUILD TOOLING, 1 SERVER RUNTIME, 1 UNREACHABLE in the inspected artifacts, zero UNKNOWN, and zero remaining P1 advisory records** for the 101 currently reported critical/high records; **zero P0 established from dependency evidence**. The single server-runtime UUID copy is embedded in the inspected API bundle, but its actual transitive callsites use only `uuid.v4()` and do not reach the advisory's affected buffer-taking API. This does not establish the contents of a deployed API image. The two initial P1 runtime advisories were addressed in Development, not deployed. Do not label an UNKNOWN as a false positive.

### Exact lock graphs and artifact evidence for the resolved records

The scanner combines the root `pnpm-lock.yaml` with the separate `readyloq-mobile/package-lock.json`; the latter is a scaffold lock, not the `artifacts/readyloq-app` manifest. Affected installed pnpm copies are under `node_modules/.pnpm/<name>@<version>/node_modules/<name>` (the matching versions are recorded in the CSV). The root lock's `snapshots` and `artifacts/readyloq-app`, `artifacts/readyloq-api`, and `artifacts/api-server` importers establish these exact paths:

| Affected copy | Root lock dependency chain and scope | Independent `readyloq-mobile/package-lock.json` evidence |
| --- | --- | --- |
| `fast-uri@3.1.2` | App dev dependency `expo-build-properties@1.0.10 → ajv@8.20.0 → fast-uri@3.1.2`; separately, `lib/api-spec` dev dependency `orval@8.9.1 → @scalar/openapi-parser@0.25.12 → ajv@8.20.0 → fast-uri@3.1.2`. | No `fast-uri` entry. |
| `linkify-it@5.0.0` | `lib/api-spec` dev dependency `orval@8.9.1 → @orval/angular@8.9.1 → @orval/core@8.9.1 → typedoc@0.28.19 → markdown-it@14.1.1 → linkify-it@5.0.0`. | No `linkify-it` entry. |
| `tar@7.5.19` | Both mobile importers have dev dependency `@expo/cli@54.0.23 → tar@7.5.19`; this is Expo CLI extraction/configuration tooling, not the API importer. | `tar@7.5.21` (not the affected version). |
| `uuid@3.4.0` | Both mobile importers have dev dependency `@expo/ngrok@4.1.3 → uuid@3.4.0`. | No `uuid@3.4.0` entry. |
| `uuid@7.0.3` | Expo CLI → `@expo/config@12.0.14 → @expo/config-plugins@54.0.5 → xcode@3.0.1 → uuid@7.0.3`. | `@expo/config-plugins@54.0.5 → xcode@3.0.1 → uuid@7.0.3`; this explains the second scanner record. |
| `uuid@9.0.1` | API production dependency `@google-cloud/storage@7.21.0 → gaxios@6.7.1 → uuid@9.0.1`; also `@google-cloud/storage → retry-request@7.0.2 → teeny-request@9.0.0 → uuid@9.0.1`. Both traced callsites request v4 only (`gaxios/build/src/gaxios.js:417`, `teeny-request/build/src/index.js:135`). | No `uuid@9.0.1` entry. |
| `ws@8.20.1` | Mobile dependency chain `@clerk/expo@3.6.2 → @clerk/clerk-js@6.22.0 → @base-org/account@2.0.1 → viem@2.53.1 → ws@8.20.1`; `viem → isows@1.0.7 → ws@8.20.1` is the second edge. The API root instead selects `@google/genai → ws@8.21.0` and `openai → ws@8.21.0`. | `ws@8.21.1` (not the affected version). |

The API build contract at `artifacts/api-server/build.mjs` externalizes the native-file glob `*.node` and the two packages `sharp` and `stripe-replit-sync`; the existing `artifacts/api-server/dist/index.mjs` has those package imports. Its source map includes UUID 9.0.1 and `ws@8.21.0`, not `fast-uri`, `linkify-it`, `tar`, `uuid@3.4.0`, `uuid@7.0.3`, or `ws@8.20.1`. This proves local bundle membership/absence, not the contents of a deployed image.

An Android Hermes export does exist at `artifacts/readyloq-app/dist/_expo/static/js/android/entry-7014569c800a51bc78030b0410b86833.hbc`; its 2,257-source `.hbc.map` has no module source for any of these affected versions. This evidence covers that export only—not a signed Production AAB. Remaining proof gaps are the final deployed API image and signed mobile AAB, plus any new build/runtime not represented by these inspected artifacts; no exposed API caller of UUID's vulnerable buffer-taking v3/v5/v6 methods was found in the traced parent packages.

## Four static-serving findings

Both `artifacts/readyloq-app/server/serve.js` and `artifacts/readyloq-api/server/serve.js` are identical packages with a `serve` script, but configured development workflows do not use them. Production reachability is **UNKNOWN** without a deployment manifest/artifact.

| Scanner file/line | Route | Class | Reproduction/evidence |
| --- | --- | --- | --- |
| `readyloq-app/server/serve.js:59` | `/manifest`, platform header | FALSE POSITIVE for remote traversal | Only the literal `ios` or `android` header reaches this path. Encoded, `../`, case-changed, and other platform values are rejected; candidate filename is fixed. Symlink-in-build-tree risk is separately handled with realpath boundary. |
| `readyloq-api/server/serve.js:59` | `/manifest`, platform header | FALSE POSITIVE for remote traversal | Same implementation and whitelist. |
| `readyloq-app/server/serve.js:102` | static URL wildcard | P1 (fix implemented; release verification pending) | Encoded/nested `..` and absolute URL paths stayed inside static root on POSIX; backslash is literal on Linux, unsafe to assume portable. **A symlink file/directory inside the build tree pointed outside and leaked bytes in an isolated fixture.** Canonical root/realpath containment and separator boundary now reject escape. |
| `readyloq-api/server/serve.js:102` | static URL wildcard | P1 (fix implemented; release verification pending) | Same vulnerability and fix. |

Regression tests cover encoded, normalized, absolute, nested and separator paths, both symlink forms, MIME, and platform header validation (2 suites passed). A fresh static scan **still reports four high sink alerts**, now at each server's read calls around lines 124 and 139: the analyzer does not prove the validated realpath is contained. Retain the regression evidence instead of clearing the scanner count by assertion. If hostile processes can mutate the static tree concurrently, a realpath-then-open time-of-check/time-of-use race remains **UNKNOWN**; serve immutable build assets and inspect deployment packaging.

## Signed-upload and evidence chain

| Boundary | Current evidence | Class / gap |
| --- | --- | --- |
| Capture | Photos copied to durable app-local storage; client timestamp/device/source metadata can be supplied. | UNKNOWN physical-byte EXIF and device clock trust. |
| Signed URL | Authenticated tenant endpoint generates a random company path and a signed PUT URL with **900-second TTL**. | **P1:** no durable reservation binding user, inspection, media type, size or checksum to later registration; possession permits PUT within TTL. Signer behavior on overwrite/type/bytes remains UNKNOWN. |
| PUT | Client sends raw bytes directly to object storage, checkpoints reserved path. | **P1:** failed/ambiguous probes can reserve a second path; cannot assert bytes or metadata meet claimed type. |
| Registration | Parent inspection and upload path are company-scoped, canonical paths required; concurrency is serialized and repeat registration returns same row. New code checks object existence before first insert; cross-company valid-path/foreign-parent attempts are denied. | Existence is not reservation ownership, signature/expiry validation, content type, bytes/checksum verification, or inspection-specific entitlement. **P1** pending a durable upload-intent/finalization contract. |
| Evidence/AI/report | Registered row is referenced in analysis and report. | Deletion after registration and later object disappearance can still create missing-media evidence. A verified/pending evidence state and reconciliation remain **P1**. |

The cross-company test models an attacker holding a known-present company-A path and trying to register it on company-B's inspection: 404, with no company-B media row or count change. This proves **that specific registration denial**, not that a signed PUT URL is single-use or cannot write bytes within its TTL.

## Orphans and retention: minimum safe design, not deletion

An uploaded object without a media row can arise after a successful PUT followed by failed registration or app kill; a retry may reserve another path. An evidence row with missing bytes can arise after later object deletion; existence-at-insert alone cannot repair it. An abandoned reservation expires as a signed URL but its bytes, if PUT succeeded, do not expire with it. Deleting an inspection does not currently prove that associated storage objects are deleted.

**P1 design:** durable upload-intent table keyed by user/company/inspection/photo operation, with expected content type, size/hash, signed path, created/expiry time, and `reserved → uploaded → verified → registered` state; one transaction claims/finalizes registration, and reconciler audits rows versus objects. Only after defining retention duration, legal hold, restore window, owner notification, and audit log should a worker mark and later delete verified **unreferenced** objects. Never infer deletion from a failed probe or delete referenced evidence automatically. No destructive cleanup was added in this triage.

## EXIF / location policy

**Decision: GPS is not needed** to evaluate an inspection photo; property address is separately recorded. Capture time, dimensions/orientation, source, and focal calibration may be useful. `media-import-provider.ts` requests EXIF but copies only `DateTimeOriginal`, `Make`, `Model` into JSON; `native-camera-provider.ts` uses `skipProcessing: true`; burst mode reads focal data from first-frame EXIF and copies original JPEGs. None of those inspected JSON paths intentionally stores GPS, but the **JPEG bytes can retain GPS/EXIF**. Other provider `captureMetadata` is forwarded verbatim to server JSONB. The normal signed PUT uses the original URI. FAIE ingestion also sends original bytes.

**P1 partial mitigation in Development:** the current mobile photo paths now make a durable JPEG copy via Expo ImageManipulator and strip JPEG APP/COM metadata segments before signed PUT, FAIE photo ingestion, bulk photo upload, and report embedding; retries migrate pending raw paths to a sanitized copy and block on sanitizer failure. Recursive location-key filtering applies to mobile metadata (including merged laser fields) and server media registration metadata for alternate/old clients. Three fixture sanitizer tests passed, as did mobile typecheck and Android Metro export. This does **not** prove every native camera/library/BLE file format and pixel-orientation case on a Fold 7, remove already uploaded GPS bytes, sanitize remote/non-mobile writes, or inspect bulk video metadata (existing video behavior was preserved). The previous server/remote media and video paths remain **P1/UNKNOWN** until their respective bytes are tested and a retention/replacement policy exists. Do not claim universal GPS removal.

## Durable AI cost and authorization

Per-call 429 retries are capped, but previously separate analysis requests could retry failed images indefinitely or race into duplicate provider calls. A durable company/inspection/canonical-media attempt record with atomic claim, lease token, and a three-claim ceiling now limits **repeat work for the same registered media path** across requests and workers. Provider output is persisted before its guard is marked complete; result insertion and completion share a transaction. Concurrent distinct-photo requests merge against the latest committed inspection result under a PostgreSQL advisory lock. Failed/rolled-back persistence can reuse the durable provider result without another call; 34 focused analysis tests passed, including crash/race cases. Successful/cached/shared work does not consume claims; expired leases count as attempts. **P1 residual:** a user can upload arbitrarily many *new* paths/inspections unless there is a tenant-wide daily spend/throughput budget; provider-internal retries and costs also need accounting. The previous **P0 before Production** repeated-*same-photo* path is mitigated in Development, but the broader cost gate is not accepted without the Production migration and budget.

See the [direct-ID matrix](phase5-direct-id-matrix.md). Most core read/write paths include company predicates; do not extrapolate to every route. **P1** candidate: same-company technician PATCH of another technician's inspection permits status/signature/completion fields without the explicit owner/manager check used by reopen. **UNKNOWN** until adverse tests/policy review: nested client portal report/media access, intelligence dataset record actions, admin token routes, FAIE caller-supplied company ID, inventory technician/user references, and every unlisted body ID. Cross-company media registration tests are representative, not exhaustive.

## Offline identity, bait-station replay, and Production verification

- **Legacy records — P1 continuity / P2 isolation mitigation:** ownership/company-unscoped local records stay physically present but inaccessible; do **not** auto-claim them. Safe recovery requires explicit quarantine/export, authenticated subject plus company reconciliation against server records and signed support/audit action before rebinding. A user confirmation alone cannot prove ownership. Do not delete or merge unidentified photo files.
- **Bait station — P0 replay integrity path mitigated for current clients:** a POST could commit before the client saved its server ID, then duplicate on retry. A durable client-generated key, tenant/inspection-scoped uniqueness, replay response, and payload-conflict rejection are implemented in Development. Mobile persists the original create payload, replays it after a lost response to recover server ID, then PATCHes later edits; concurrent edit acknowledgement does not clear pending work. Focused server and mobile crash tests passed. Older keyless clients retain compatible create behavior but **can still duplicate after ambiguous POST (P1 legacy-client residual)**. No duplicate historical records were deleted.
- **Cold offline — P1 behavior gap, safe fail-closed:** restored Clerk session can know the subject and AsyncStorage can hold a same-subject last profile, but local scope activation requires fresh `/api/auth/me` confirmation. On a cold offline start it therefore shows an offline waiting screen; warm in-process verified scope persists offline. No-cache/unauthenticated cold launch must stay locked. Enabling local-only cold access would need a previously verified subject+company-bound authorization snapshot with revocation window, expiry and tenant-query invalidation; it cannot guarantee a company was not revoked while disconnected. No auth bypass was added.
- **EAS/Production — UNKNOWN, gate blocked:** artifact production profile specifies AAB, Production channel, live Clerk/API configuration and Node version, but root EAS/app configs differ and no signed Production build was inspected. Read-only Expo build inventory showed recent **preview** Android version 221, runtime 1.0.0; it does **not** verify current source, Production EAS signing fingerprint, iOS provisioning, embedded Production Clerk/API values, native runtime/channel, absence of internal Replit package host, or absence of debug credentials/endpoints. Static Gradle signing guard is not an artifact signature. No build, OTA, submission or publish was run.
- **Schema changes (Development only):** startup migrations create `analysis_provider_attempts` with a recoverable provider result and claim state, and add bait-station idempotency columns/unique key by company, inspection and client key. The managed Development API started with both migrations. Production schema and deployment order have **not** been changed or verified.

## Physical Fold 7 acceptance (actual device)

| Case | Result |
| --- | --- |
| A→B account switching | NOT RUN — no connected physical Fold 7 |
| A→B company switching | NOT RUN — no connected physical Fold 7 |
| Super Admin→normal user | NOT RUN — no connected physical Fold 7 |
| Logout/login | NOT RUN — no connected physical Fold 7 |
| Warm offline | NOT RUN — no connected physical Fold 7 |
| Cold offline with previously verified subject/company | NOT RUN — no connected physical Fold 7 |
| Cold offline with no authenticated session | NOT RUN — no connected physical Fold 7 |
| Network loss | NOT RUN — no connected physical Fold 7 |
| App kill during photo upload | NOT RUN — no connected physical Fold 7 |
| App kill during sync/checkpoint/registration | NOT RUN — no connected physical Fold 7 |
| Duplicate retry | NOT RUN — no connected physical Fold 7 |
| Partial retry | NOT RUN — no connected physical Fold 7 |
| Legacy migration/quarantine | NOT RUN — no connected physical Fold 7 |
| Storage exhaustion | NOT RUN — no connected physical Fold 7 |
| Signed release installation/signature/runtime | NOT RUN — no connected physical Fold 7 or Production build |

Record these separately on the actual Fold 7; source tests, browser preview, Expo sandbox, or an emulator cannot substitute. The Expo **web** preview currently shows an uncaught BLE `createClient` error from `SmartGlassesBleManager`; Android Metro export passed, but neither proves native Fold 7 operation. This pre-existing-looking web incompatibility was not repaired or treated as physical-device evidence.

## Verification and unresolved test failures

- Final focused server run: **59/59** across analysis, inspection media, and bait-station suites. Bait-station tenant isolation with legacy keyless POST: **12 passed** in a scoped run. Focused mobile ownership/sync/privacy run: **31/31**. Static serving: **2/2** suites, covering both copies. Mobile typecheck, Android Metro export, API build and Development `/api/healthz` passed. Startup logs confirmed the new analysis-provider and bait-station schema migrations in **Development only**.
- A broader isolation run had **109 passed, 14 skipped, 2 failed** before the legacy keyless bait compatibility fix. The bait case passed after the fix; the other treatment-log test still tries to delete every product in a shared test database and hits an unrelated inventory foreign key. This is a test-fixture isolation problem, not a passing test. A mail scheduler suite passed **10/11**; the opted-out-owner case asserts zero global sends while other fixture companies can send, so its assertion is not isolated to the opted-out owner. No real email was sent.
- Full API typecheck remains red with **25 existing test-file errors**; changed routes/build compile. `git diff --check` still reports two whitespace-only lines from bundled third-party comments in generated `artifacts/api-server/dist/index.mjs`; source files passed the check. Do not mistake a clean targeted suite for a clean project.

**Phase 5 remains NOT ACCEPTED. Do not begin Phase 4 or Phase 6.**