---
name: Evidence capture timestamps
description: Durable timestamp semantics for inspection media across mobile, API, database, and portal.
---

Evidence media has two distinct instants: `capturedAt` is authored by the capture device and must survive offline retries unchanged; `createdAt` is the server media-row registration/audit time and must remain server-generated.

**Why:** Registration may happen hours after capture during offline work. Treating registration time as capture time makes evidence chronology inaccurate, especially across midnight.

**How to apply:** New clients send the persisted local capture timestamp during media registration. Store it separately and prefer it in evidence UI, falling back to registration time for historical rows. Production schema changes use the managed Publish diff, never startup DDL.