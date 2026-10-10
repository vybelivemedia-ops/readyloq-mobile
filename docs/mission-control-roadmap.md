# ReadyLoq Mission Control roadmap and Phase 5 gate

## Order

1. Phase 1 — Native Super Admin Mission Control
2. Phase 2 — Operational Drill-Down & Actions
3. Phase 3 — Governance, Approvals & Audit (**pending physical Fold 7 acceptance**)
4. Phase 5 — Production Hardening & Data Isolation (**immediate engineering priority**)
5. Phase 4 — AI Operations & Decision Support (**fully deferred**)

Do not start additional Mission Control features or any Phase 4 AI intelligence, anomaly detection, natural-language Mission Control investigation, or autonomous AI recommendations while Phase 5 is in progress. Do not start Phase 4 or Phase 6 automatically after Phase 5: stop and report Phase 5 acceptance results first. Phase 4 requires explicit acceptance of Phase 5.

## Phase 5 scope

1. Offline/local data isolation, authenticated ownership, account/company switching, and logout continuity.
2. Sync reliability and recovery from crashes, app kills, network loss, concurrent attempts, partial progress, migration, and storage exhaustion; idempotent replay without silent failures.
3. Direct API authorization across inspections, evidence, storage, reports, analysis, datasets, properties, intelligence, CRM, and tenant administration.
4. Capture → upload → registration → evidence → AI → report integrity, including signed URL ownership/expiry, orphan cleanup, revisions, retry limits, provider ambiguity, cost protection, and EXIF/location handling.
5. Production/Development separation, EAS release configuration and signing, dependency provenance, and absence of test credentials/endpoints.
6. Root-cause resolution of mobile `@platform/*` TypeScript/workspace errors and minimal mobile tests for critical isolation, replay, registration, tenant access, and AI retry paths.
7. Production security hardening.

## Acceptance and report

Phase 5 is **not complete** until authenticated local data cannot leak across users/accounts; sync resumes safely after crashes and network interruptions without duplicates; partial sync is visible and recoverable; direct cross-company API access is denied; upload registration is idempotent; AI retries are bounded; Production configuration is separated from Development; release signing is verified; mobile typecheck has no unexplained errors; and the new critical tests pass.

Report security findings, vulnerabilities fixed, tests added and passed/failed, remaining risks, production configuration findings/changes, database/schema changes, and required manual Fold 7 tests. Physical Fold 7 acceptance cannot be inferred from emulator, browser, source inspection, or build configuration.