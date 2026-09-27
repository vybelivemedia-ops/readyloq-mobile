---
name: PestPac bidirectional activation
description: Safety boundary for activating ReadyLoq's inbound PestPac and inventory-usage synchronization.
---

Keep automated inbound PestPac polling and outbound inventory-usage delivery disabled until Nate confirms the production authentication, endpoint, pagination, cursor, rate-limit, payload, error, media, and sandbox contracts.

**Why:** The currently implemented customer, location, route, work-order, and inventory-usage paths are provisional. Automatically calling them before contract confirmation could create incorrect schedules or send usage to the wrong endpoint.

**How to apply:** The existing outbound inspection-report bridge can continue operating. Activate the new bidirectional worker only after the contract follow-up is complete and sandbox fixtures verify the confirmed wire format.

Guarded stop-history reads share this activation boundary. The implemented REST contract uses the company account as `tenant-id`, the configured API key as `apiKey`, and the server-stored OAuth bearer token; it resolves a company-scoped work-order link to a company-scoped location link before reading legacy location notes. Mobile callers never supply external IDs or credentials, and vendor failures must leave ReadyLoq's local history usable.

**Why:** Property history is valuable before full bidirectional sync activation, but accepting vendor identity or credentials from a mobile caller would break tenant isolation and credential containment.

**How to apply:** Keep legacy reads dormant with polling by default. When production activation is approved, configure the OAuth bearer token server-side and verify the location-notes path, pagination, and token lifecycle against PestPac's live contract before enabling the shared flag.