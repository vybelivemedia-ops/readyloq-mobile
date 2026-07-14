---
name: Mission Control dev maintenance & virtual-day simulation
description: How "Simulate Tomorrow" and the dev maintenance endpoints stay correct given a date-keyed briefing and an unauthenticated MC router.
---

## Simulating a future day without a virtual clock
The COO briefing is strictly keyed on a UTC date string (`dailyCOOBriefingsTable.date`, YYYY-MM-DD). The system has **no** virtual-clock / date-offset infrastructure.

**Rule:** to "advance one virtual day" (e.g. Simulate Tomorrow Morning), generate a briefing for a *future date string* (`dateUTCOffsetDays(1)`) via a date-targeted generator — do NOT call the today-bound `regenerateTodaysBriefing()`, which overwrites the real current-day briefing.

**Why:** overwriting today's briefing is destructive and semantically wrong for a "tomorrow" preview; producing a row dated tomorrow leaves today intact and reads as a genuine next-day advance. The briefing generator (`getOrGenerateTodaysBriefing` / `generateWithAI`) takes an optional target-date param so callers can target any date.

**How to apply:** any date-dependent simulation must thread the target date through the generator instead of mutating the clock or clobbering the current day's record.

## Rebuild = complete, caps are safety-only
A "rebuild" maintenance action (e.g. Rebuild Founder Memory) must re-analyze the *entire* source history, not a recent slice. Keep any row cap as a pathological-runaway guard set far above realistic data size — a low cap silently turns "rebuild" into "partial rebuild" and drops older evidence.

## MC router is unauthenticated by convention
The whole Mission Control router (internal AI HQ) is mounted with **no auth**, including its destructive dev endpoints (reseed, remove-test-data, resets). New dev endpoints match this convention. Do not bolt auth onto only the new endpoints — that is inconsistent and out of scope; any hardening must cover the whole MC surface as a deliberate, separate decision.
