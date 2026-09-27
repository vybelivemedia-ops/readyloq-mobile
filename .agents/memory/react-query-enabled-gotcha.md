---
name: React Query enabled-with-falsy-value gotcha
description: Boolean(x) as an `enabled` guard silently disables the query forever for defined-but-falsy values like ""; distinguish "no value" from "loading/error" explicitly
---

# React Query `enabled` guard on a falsy-but-defined value

`useQuery({ enabled: Boolean(someValue) })` looks like a safe "wait until we have a value" guard, but if `someValue` can be an empty string (not `null`/`undefined`) — e.g. a required id field that's absent on some records — `Boolean("")` is `false`, so the query never runs. With `enabled: false`, react-query reports `isLoading: false`, `isError: false`, `data: undefined` indefinitely (not a pending state), so a component whose generic error branch is `isError || !data` shows a misleading "couldn't load" message instead of a "no value provided" message — and there's no visible sign the query never fired.

**Why:** Hit this where a disabled-forever query state was indistinguishable from a real fetch error in the render logic, producing a confusing error message for what was actually a valid "nothing to look up" case.

**How to apply:** When a query's `enabled` guard depends on a value that could reasonably be an intentional "no value" (null/empty), branch on that case explicitly in the UI *before* the isLoading/isError/data checks, so "we don't have an id to look up" reads differently from "the lookup failed."
