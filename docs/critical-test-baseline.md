# ReadyLoq critical test baseline

## Scope and freshness

Prioritized inspection ownership/tenant isolation, signatures and signature
sync/patch, partial AI retry, completion and media boundaries, FAIE ingestion
authorization, and development-fixture production protection. Expanded mobile
regressions cover Voice Capture/final transcription/photo evidence,
multilingual commands, native Meta JS/session configuration, privacy, delivery,
and local/sync storage.

The initial checks used `vitest run --no-cache`. Historical Vitest failure
flags were inspected separately, not treated as current test results. All ten
historically failing suites in the selected scope reproduced fresh: five
mobile and five API. **Zero were confirmed stale cached failures.**
Outdated fixtures/contracts are different from stale cached results.

## Initial fresh results

| Area | Suites | Passed tests | Failed tests | Skipped tests | Other failures |
| --- | --- | ---: | ---: | ---: | --- |
| API, original 13 suites | 9 passed, 4 failed | 244 | 36 | 11 | 2 failed setup hooks |
| API, additionally checked development production gate | 1 failed | 1 | 3 | 0 | — |
| Mobile, original 9 suites | 4 passed, 5 failed | 43 | 0 | 0 | 5 failed collections |

The API initial aggregate was 245 passed, 39 failed, and 11 skipped across
14 suites, plus the two setup-hook failures. Failed mobile collections had no
collected tests; they were not passing assertions.

## Corrections

### Genuine runtime defects exposed after fixture repair

- Registered upload replay checked URL tenancy only on first registration.
  Foreign/malformed object claims are now rejected before returning a registered
  row. Existing same-company cropped replacement retries still return the
  original registered evidence, as required by the existing regression.
- The transactional AI recovery merge restored findings, acknowledged paths,
  zones, and outcomes from previously successful assessments even after their
  media rows were deleted. The merge now re-reads current inspection/company
  photo evidence after provider work and excludes deleted/unregistered photos
  from prior and durable-recovery state. A regression also deletes the media
  while the provider is in flight and verifies persisted results stay empty.

### Test harness/contract defects

- Node-only store/sync tests imported the actual native image encoder, causing
  React Native Flow parsing, `__DEV__`, or native-registry errors at collection.
  SDK-boundary mocks now isolate the encoder, not the real store/sync code.
  Expanded checks found the same problem in two additional local-store suites.
- Media setup omitted required upload reservations and storage metadata.
  Fixtures now create real authenticated-actor/tenant/inspection-bound
  reservations and mock only object metadata. The foreign-company prior-visit
  fixture uses its actual authenticated owner.
- The isolation treatment-log setup deleted unrelated products referenced by
  the immutable inventory ledger. Cleanup now targets its own tenant records.
- Foreign DELETE expected the old 204 response rather than the current
  non-disclosing 404; the original row-survives assertion remains.
- Development-only endpoint tests expected an obsolete authentication
  catch-all's 401. An unmounted route now correctly returns Express 404.
  Tests also verify no insert/update happens and that enabling deployment mode
  after app import triggers the mounted route's runtime guard.
- Two mixed-success AI mocks depended on provider call order despite concurrent
  claims. They now select success/failure by exact photo path.
- AI capacity tests inherited consumed daily counters from earlier cases/runs.
  Only the isolated test database's fixture quota state is reset; production
  quota limits and guards are unchanged.
- Different label-only requests must have distinct analysis result IDs, but
  may reuse one durable assessment of the same photo. Assertions now distinguish
  request identity from provider recovery; the distinct-ID assertion remains.
- The new registered-replay regression now uses a unique object path, since
  upload reservations intentionally survive inspection deletion.

## Final fresh verification

| Area | Suites | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| API critical + FAIE/voice regressions | 15 | 303 | 0 | 0 |
| Mobile critical + capture/privacy/Meta regressions | 25 | 236 | 0 | 0 |
| Unique aggregate | 40 | 539 | 0 | 0 |

API verification is aggregated without double-counting: the final full run
had 302 passing tests and one new fixture-path collision. After making only
that path unique, its complete 32-test media suite passed fresh. All other
suites' checks remain valid. The final regular Vitest executions also refreshed
the selected suites' cached status flags; they did not replay cached results.

- Mobile `tsc -p tsconfig.json --noEmit`: passed.
- API TypeScript check over production-source roots (excluding test/spec files):
  passed. This is not a claim that every historical test fixture typechecks.
- `git diff --check`: passed.
- Development API restarted successfully; `/api/healthz` returned 200.
  Startup still reports the existing unavailable Stripe integration. Billing
  configuration was not changed.
- Portal sign-in screenshot rendered normally; it is not signed-in/device proof.

## Limits

Five other historical API failure flags were outside this critical scope and
were **not** classified as stale or current: products, briefing scheduler,
restock alerts, PestPac sync, and Mission Control inspection events.
The whole repository is not claimed clean.

No Android/Expo APK was built, packaged, distributed, or published.
No dependency upgrades or native Meta implementation changes were made.
Physical Meta/Voice Capture and production integrations were not verified by
these automated checks.
