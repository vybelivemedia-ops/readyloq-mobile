---
name: Drizzle count pattern
description: db.$count() cannot be used inside .set({}); use a separate select query
---

`db.$count(table, condition)` returns a scalar subquery object, not a plain number. Using it inside `.set({ col: db.$count(...) })` compiles but produces a runtime error or incorrect SQL.

**Rule:** Calculate count with a separate query first:
```typescript
const [{ total }] = await db
  .select({ total: count() })
  .from(table)
  .where(condition);
await db.update(otherTable).set({ col: Number(total) }).where(...);
```

**Why:** Drizzle's `.set()` expects plain values or raw SQL fragments, not subquery builders.
