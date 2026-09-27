---
name: Role access rank convention
description: This project's role hierarchy (technician < sales < manager < owner) and the "sales gets company-wide reads" convention new endpoints must decide on
---

# Role access rank convention

This project ranks roles technician < sales < manager < owner. Sales sits above technician: existing company-wide read routes commonly treat sales the same as manager/owner (not self-scoped like technician), because sales reps are a real audience for many read features but are never assigned as the "owner" of a record the way a technician is — a self-scoped fallback silently returns empty results for them instead of erroring.

**Why:** A newly added endpoint copied an existing manager/owner-only visibility check verbatim, which silently broke it for the sales role (empty result, no error) — easy to miss without testing that specific role.

**How to apply:** When adding an endpoint meant to be visible to sales, explicitly decide and test whether sales gets company-wide read access (like manager/owner) or self-scoped access (like technician) — don't copy an existing manager/owner check without checking the intended audience for the new feature. Some older endpoints in this project still have this gap; don't assume an existing check's scoping is correct for a new consumer just because it's already in use elsewhere.
