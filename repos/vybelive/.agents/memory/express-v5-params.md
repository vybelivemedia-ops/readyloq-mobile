---
name: Express v5 params type
description: req.params values are string | string[] in Express v5, breaking Drizzle eq() calls
---

In Express v5, `req.params.X` has type `string | string[]` (not `string`). Drizzle's `eq()` only accepts `string | SQLWrapper`, so passing a raw param causes TS2769.

**Rule:** Always cast: `eq(table.col, String(req.params.X))` — never use `req.params.X!`.

**Why:** Express v5 changed param types to support multi-value params; Drizzle is strict about the right-hand operand type.

**How to apply:** Any new route that uses `req.params` in a Drizzle `eq()` call needs the `String()` cast.
