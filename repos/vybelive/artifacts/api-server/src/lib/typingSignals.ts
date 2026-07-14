/**
 * Ephemeral typing-signal store.
 *
 * Transport choice: typing indicators are intentionally NOT persisted. They are
 * held in-process in a Map and observed by other participants through
 * short-interval polling of GET /conversations/:id/typing. This keeps the
 * feature low-overhead and avoids introducing new persistent real-time
 * infrastructure (websockets / pub-sub). A signal is considered active for
 * TYPING_TTL_MS after it was last published; stale entries are swept lazily on
 * read and writes.
 *
 * Trade-off: because state is per-process, typing indicators are best-effort and
 * scoped to a single API instance. That is acceptable for an ephemeral hint that
 * self-heals within a few seconds.
 */

const TYPING_TTL_MS = 6000;

// key: `${conversationId}:${userId}` -> expiry epoch ms
const signals = new Map<string, number>();

function sweep(now: number): void {
  for (const [key, expiry] of signals) {
    if (expiry <= now) signals.delete(key);
  }
}

export function setTyping(conversationId: string, userId: string, isTyping: boolean): void {
  const key = `${conversationId}:${userId}`;
  if (isTyping) {
    signals.set(key, Date.now() + TYPING_TTL_MS);
  } else {
    signals.delete(key);
  }
}

/** Returns the userIds currently typing in a conversation, excluding `exceptUserId`. */
export function getTypingUserIds(conversationId: string, exceptUserId: string): string[] {
  const now = Date.now();
  sweep(now);
  const prefix = `${conversationId}:`;
  const result: string[] = [];
  for (const [key, expiry] of signals) {
    if (expiry > now && key.startsWith(prefix)) {
      const uid = key.slice(prefix.length);
      if (uid !== exceptUserId) result.push(uid);
    }
  }
  return result;
}
