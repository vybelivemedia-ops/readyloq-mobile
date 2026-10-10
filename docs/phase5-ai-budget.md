# Phase 5 AI provider-call budget

## Policy and scope

The photo-analysis endpoint reserves one durable call unit before every new
provider request. The default ceilings are **100 photo-provider requests per
company per UTC calendar day** and **1,000 requests across the entire platform
per UTC calendar day**. They can be configured consistently across API workers
with:

- `ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PER_COMPANY`
- `ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PLATFORM`

Both accept integers from 0 through 1,000,000; zero disables new provider work.
The limit is captured in each scope/date row on its first reservation and stays
fixed for that UTC day. A changed deployment configuration therefore takes
effect for a scope when its next UTC-day row is created. Invalid configuration
fails closed instead of silently selecting a larger quota.

The existing **three-claim ceiling per company/inspection/canonical media path**
remains in force. Cached, in-flight shared, and durably recovered results do not
need a new provider call and do not consume the daily quota.

## Atomicity and failure behavior

`analysis_provider_daily_budgets` stores per-company rows keyed by company and
UTC date and a platform row keyed by reserved scope id `0`. In one PostgreSQL
transaction, the route claims the per-media lease and atomically increments
both applicable counters before it calls the provider. The primary keys and
conditional upserts serialize independent requests across API processes and
workers. If either ceiling is exhausted, the transaction rolls back the media
claim and any partial quota increment, records the photo as deferred, and makes
no provider call.

A committed reservation is **not refunded**. This deliberately prefers
over-counting to a free retry when a worker crashes after reservation but
before the provider call or before it can persist the result. A failed provider
request may be retried through a later analysis request, but it must obtain a
new daily reservation and remains subject to the per-media three-claim ceiling.

The analysis route disables its internal 429 retry loop and the OpenAI request
sets SDK `maxRetries: 0`; each accounted queue invocation therefore makes at
most one underlying provider request. Provider-internal retries are disabled,
not charged invisibly. Retrying after a 429 is explicit, durable route-level
work and consumes another reservation.

## Evidence

Focused route tests cover:

- new paths on distinct inspections with changed request payload/IDs exceeding
  the company daily cap without another model call;
- concurrent requests on different inspections racing for the last company
  unit, with only one call and no quota oversubscription;
- a zero platform quota preventing provider work and rolling back the media
  claim and partial company reservation;
- the existing same-media three-claim cap and durable crash recovery;
- one provider request for each durable reservation: the queue passes zero
  route-level 429 retries and the OpenAI SDK's `maxRetries` is explicitly zero.

The tests use PostgreSQL persisted rows, not an in-memory limiter. Their
independent inspection/path requests bypass the route's exact-payload
single-flight key. The reservation SQL is transactionally backed and is shared
by API workers. **Focused verification:** 57/57 across analysis-route, queue,
and provider-retry suites; workspace library typecheck and API build passed.
A multi-host deployment has not been exercised here.

## Remaining risk

This is a **provider-call-count quota**, not a monetary ledger. Actual charge
per request can vary with image bytes, prompt/model pricing, and completion
tokens, so the daily cap does not promise an exact dollar ceiling. The two
configurable limits must be set consistently on all Production workers, and
Production schema migration order, quota values, and real billing behavior
remain unverified. Daily accounting rows are not pruned automatically; define
an audit/retention policy before adding a destructive maintenance job.