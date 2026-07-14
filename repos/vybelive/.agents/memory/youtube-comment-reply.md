---
name: YouTube comment reply (Unified Inbox)
description: How replying to inbox comments maps onto the YouTube Data API and the scope it requires.
---

# YouTube comment reply

Replying to an inbox comment posts via YouTube Data API v3 `comments.insert`
(`POST /comments?part=snippet`, body `{snippet:{parentId, textOriginal}}`).

- **parentId == inbox item id.** A commentThread's id equals its top-level
  comment id, and the inbox stores the thread id as `InboxItem.id`, so the same
  value is a valid `parentId` for the reply. No extra lookup needed.
- **Scope:** `comments.insert` needs `youtube.force-ssl`; the broad `youtube`
  scope alone does NOT grant comment writes. It's in the YouTube OAuth scope
  list now, but accounts connected before it was added must reconnect — until
  then a reply returns 403 (surfaced honestly as a 502 with a reconnect hint).

**Why:** these two facts are external YouTube API behavior, not derivable from
our code, and getting either wrong makes replies silently 403/400.

**How to apply:** when extending inbox replies to another platform, mirror the
capability gate (`replySupported`) and keep the honest-error contract (no fake
"sent"); don't assume a read scope covers writes.
