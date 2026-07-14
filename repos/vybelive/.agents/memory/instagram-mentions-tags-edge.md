---
name: Instagram @-mentions via Tags edge
description: Why the IG inbox reads /tags (not mentioned_media/mentioned_comment) for @-mentions, and how story replies are gated.
---

# Instagram @-mentions & story replies in the unified inbox

**Rule:** to enumerate Instagram @-mentions for the inbox, read the account's
Tags edge `GET /{ig-user-id}/tags` — NOT the `mentioned_media` /
`mentioned_comment` fields.

**Why:** `mentioned_media` / `mentioned_comment` are field-expansions that only
resolve when you already hold a specific media/comment id delivered by a
`mentions` webhook (`GET /{ig-user-id}?fields=mentioned_media.media_id(<id>)`).
They are NOT list edges, so they cannot be fetched on demand without a webhook +
stored ids. The Tags edge IS listable and is the real, enumerable "where others
@mentioned/tagged you" source. Both use the existing `instagram_manage_comments`
scope.

**Story replies:** they arrive as Instagram Direct messages and need
`instagram_manage_messages` (messaging), which this app does not request. Surface
an honest unavailable sub-source — never a placeholder, never a fake fetch.

**How to apply:** `getInstagramInbox` returns `InboxFetchResult { items,
sources }` where each engagement surface (comments / @-mentions / story replies)
degrades independently and reports its own availability via an `InboxSubSource`.
Mention items set `replySupported: false` (they live on someone else's media, so
the owner's comment-reply flow can't answer them). If you ever add real story
replies, add the messaging scope AND gate the fetch behind it.
