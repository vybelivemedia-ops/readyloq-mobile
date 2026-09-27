---
name: Warehouse tier & transaction ledger schema
description: Invariants for company/technician stock balances, an immutable movement ledger, and multi-scope override tables.
---

**Ledger completeness is a system invariant, not a per-route add-on.** Every code path that changes a stock balance — relative or absolute, including batch/import paths — must write an immutable ledger row. **Why:** an audit trail covering only some balance-changing paths is untrustworthy; this was caught missing on several paths across multiple review rounds, each fixed in isolation while others still had gaps. **How to apply:** when adding any new way to change a balance, ask "does this write a ledger row" before shipping it, not after — and re-grep for every mutator of the same table when one is found missing, since there is likely another.

**Balance mutation requires unit-safety AND identity-scoped serialization together — neither alone is sufficient.** A quantity can only combine with an existing balance when units match (reject, never convert or silently combine). Separately, concurrent first-time writers to the same balance can each pass their own unit check before either has written a row, since a row lock protects nothing until the row exists — serialize against the balance's logical identity, not the row. **Why:** both bugs shipped independently and each looked fixed in isolation while the other still allowed corruption.

**A value's current state is not the only precondition for safely changing it — check for live records elsewhere that still assume its old value and could later replay against it.** E.g. permitting a unit change whenever a balance is currently zero misses that an undeleted historical deduction assumed the old unit, and reversing it later (via delete) would silently fail once the unit has moved. **How to apply:** before relaxing a validation rule based on "current state looks safe," search for other records that reference this entity and could still act on the pre-change assumption.

**When a generic override table's uniqueness key spans multiple independently-optional scope dimensions (sentinel values marking "unscoped"), ship create/read/update/delete for every combination the key allows, not just the single-dimension ones.** **Why:** a table that can physically store a combined-scope row but has no API to create, list, or edit it is a silent gap — caught in review after each single-dimension scope was already fixed.

**Sentinel-based uniqueness for optional overrides:** a "default with optional per-X/per-Y override" table can use non-null sentinel values instead of nullable columns to keep a single uniqueness constraint enforceable via upsert.
