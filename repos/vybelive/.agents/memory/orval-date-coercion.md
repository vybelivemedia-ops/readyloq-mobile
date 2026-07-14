---
name: Orval date field coercion inconsistency
description: Orval emits z.coerce.date() only for OpenAPI format:date-time; plain string properties stay unvalidated, so the same field can be a Date in one body and a raw string in another.
---

# Orval date field coercion

When an OpenAPI request-body property is declared with `format: date-time`, Orval
generates `z.coerce.date()` for it — the parsed value is a real `Date` and an
invalid string fails `safeParse` (handler can return 400 cleanly). When the same
logical field is declared as a plain `type: string` (no `format`), Orval
generates `z.string()` and performs **no** date validation — `new Date(value)` in
the handler can silently produce an `Invalid Date` and reach the DB.

**Why:** This bit Mission Control — `dueAt` was `format: date-time` in the create
body but a plain string in the update body, so create validated dates while
update did not. A bad `dueAt` on PATCH could 500.

**How to apply:** Keep a given field's declaration consistent across every
request body in `lib/api-spec/openapi.yaml` (prefer `format: date-time` for
dates). Where you can't, validate the raw string in the handler before
`new Date()` — guard with `Number.isNaN(d.getTime())` and return 400. Don't
assume `parsed.data.<field>` has the same TS type across operations; check the
generated zod (`z.coerce.date()` vs `z.string()`).
