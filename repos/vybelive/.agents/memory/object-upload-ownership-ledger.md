---
name: Object upload ownership ledger
description: Why presigned-upload flows need a server-side uploader ledger to prevent object-takeover, and where to enforce it.
---

# Object upload ownership ledger

**Rule:** Any route that takes a client-supplied `/objects/...` path and rebinds its
ACL (e.g. `trySetObjectEntityAclPolicy(owner=caller)`) MUST first verify the caller
actually uploaded that object. Verify against a server-side upload ledger that records
the issuing user at presigned-URL issuance time — do NOT blindly rebind.

**Why:** ACL ownership metadata can only be written *after* the object exists (the GCS
file is created when the client PUTs to the presigned URL). At issuance time there is
no object to stamp, so you cannot record the uploader in object metadata. Without a
separate record, the first server route to touch the path "wins" ownership — letting
any authenticated user rebind a leaked/guessed `objectPath` (avatar, recording, another
user's DM media) to themselves: object takeover. A code review flagged this as BLOCKING
on the DM media-attachment send route.

**How to apply:**
- Record `{ objectPath, userId, contentType }` in a ledger table at presigned-URL
  issuance (the upload-URL route is authenticated, so the issuing user is known).
  Use upsert (`onConflictDoUpdate`) keyed on objectPath.
- At consume time (e.g. DM send-attachment image/video branch), SELECT the ledger by
  objectPath and reject (404) if missing or `row.userId !== caller` BEFORE binding ACL.
- Owned shared entities (clip/stream) already check `entity.userId === caller`; profile
  sharing intentionally only checks existence. Only the raw-object path needs the ledger.
- Non-blocking hardening: TTL/cleanup of stale ledger rows to bound growth.
