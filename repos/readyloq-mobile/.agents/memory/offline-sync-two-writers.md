---
name: Offline sync two-writer rule
description: AsyncStorage record with two writers (capture UI + sync engine) — all writes must be serialized read-modify-write merges; sync must be single-flight
---

# Rule
Once a local record can be written by two parties (capture UI holding a ref + background sync engine), NEVER do whole-record saves from a held copy. All writes must go through a store-level `updateLocalInspection(localId, mutator)` that serializes read-modify-write cycles through a promise chain. The sync engine must be single-flight: `syncNow` shares the same `running` lock as the debounced `syncAll`, plus a per-record `syncingIds` guard.

**Why:** A whole-record save from a stale copy silently drops fields the other writer just set — a photo captured mid-sync could be lost permanently, or a photo missing its just-written `storagePath` gets uploaded twice (duplicate media rows). Found by architect review; both paths existed before the merge-update refactor.

**How to apply:** Any new mutation of a local inspection record (UI or engine) must use `updateLocalInspection` with idempotent re-checks inside the mutator (e.g. only set `storagePath` if unset, key photos by `localUri`). Direct `saveLocalInspection` is only safe for brand-new records with no other writer.

# Related quirk
Server status strings differ by table: the inspections row becomes `"completed"` on completion, while reports/analysis rows use `"complete"`. Any client polling for terminal state should accept both.
