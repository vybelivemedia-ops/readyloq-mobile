---
name: Discovery/feed exclusion via bounded anti-join
description: How to exclude self + already-followed creators on hot list endpoints without unbounded queries
---

# Excluding already-followed creators on hot paths

When a list/feed endpoint must exclude the requester and everyone they already
follow (discovery, suggestions, "who to follow"), do NOT materialize the viewer's
full follow list and feed it into `notInArray(...)`.

**Rule:** use a correlated `NOT EXISTS` anti-join against `follows`
(`follows.follower_id = viewerId AND follows.followed_id = <candidateCol>`) plus
`ne(id, viewerId)`. In Drizzle, build it with `notExists(db.select({one: sql\`1\`})
.from(alias(followsTable,"excl_follows")).where(...))` and pass the candidate
column so it can correlate to either `usersTable.id` or `followsTable.followedId`.

**Why:** a viewer with many follows produces a huge in-memory array and a huge SQL
parameter list (can hit the DB param limit and degrades the hot path). The
bounded-hot-path / no-unbounded-full-scan constraint forbids it. The anti-join is
backed by the `follows_follower_followed_unq` unique index.

**How to apply:** any new discovery/feed/recommendation endpoint that excludes the
follow graph. Sample the viewer's following set with an explicit `.limit()` only
when you need the IDs themselves (e.g. 2nd-degree overlap), never for exclusion.
