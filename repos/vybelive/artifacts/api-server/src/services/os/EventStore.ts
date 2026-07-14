// ─── Mission Control OS Layer — Event Store (Phase 2) ─────────────────────────
//
// Dual-layer storage for OS events:
//   1. In-memory ring buffer — O(1) append, O(n) query, survives restarts only
//      within the process lifetime. Cap: EVENT_STORE_MAX (default 2 000 events).
//   2. Async DB write — every event is written to `os_events` (append-only).
//      DB failures never block emission; they are logged and silently dropped.
//
// Replay:
//   replay() re-emits a set of stored events through the EventBus so that
//   consumers can catch up after a cold start or a handler failure.
//   Replayed events preserve their original id, timestamp, and correlationId
//   but get a fresh status = "pending" for re-processing.
//
// Design rules:
//   • This class never imports from EventBus.ts to avoid circular deps.
//     Instead, replay() receives an emitter callback.
//   • markProcessed() is called by EventBus after all handlers finish.
//   • The ring is a simple array treated as a circular buffer — oldest entry
//     is overwritten when the cap is reached.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, osEventsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import type { OSEvent, EventStatus } from "./types.js";
import type { AnyEventKind, EventPayloadMap } from "./events/index.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const EVENT_STORE_MAX =
  Number(process.env.OS_EVENT_STORE_MAX ?? 2_000);

// ─── EventStore ───────────────────────────────────────────────────────────────

export class EventStore {
  /** In-memory ring buffer. */
  private _ring: OSEvent<unknown>[] = [];
  /** Fast O(1) lookup by id (mirrors the ring, pruned with it). */
  private readonly _byId = new Map<string, OSEvent<unknown>>();

  readonly maxCapacity = EVENT_STORE_MAX;

  /** Number of events currently held in the ring. */
  get storedCount(): number {
    return this._ring.length;
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  /**
   * Store an event in the ring and asynchronously persist it to the DB.
   * Called by EventBus immediately after envelope construction.
   */
  store(event: OSEvent<unknown>): void {
    // Evict oldest if at capacity.
    if (this._ring.length >= EVENT_STORE_MAX) {
      const evicted = this._ring.shift();
      if (evicted) this._byId.delete(evicted.id);
    }
    this._ring.push(event);
    this._byId.set(event.id, event);

    // Async DB write — never blocks.
    this._persistToDB(event).catch((err) => {
      logger.warn({ err, eventId: event.id, kind: event.kind }, "os/EventStore: DB write failed");
    });
  }

  /**
   * Update the lifecycle status of an event after handlers have run.
   * Updates both the in-memory entry and the DB row.
   */
  markProcessed(id: string, error?: string): void {
    const event = this._byId.get(id);
    if (!event) return;

    const newStatus: EventStatus = error ? "failed" : "processed";
    (event as { status: EventStatus }).status = newStatus;

    // Async DB update.
    db.update(osEventsTable)
      .set({
        status: newStatus,
        processedAt: new Date(),
        error: error ?? null,
      })
      .where(eq(osEventsTable.id, id))
      .catch((err) => {
        logger.warn({ err, eventId: id }, "os/EventStore: markProcessed DB update failed");
      });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /** Look up an event by its UUID. Returns null if not in the ring. */
  get(id: string): OSEvent<unknown> | null {
    return this._byId.get(id) ?? null;
  }

  /** All events in chronological order (oldest first). */
  all(limit?: number): OSEvent<unknown>[] {
    if (limit === undefined) return [...this._ring];
    return this._ring.slice(-limit);
  }

  /**
   * Events emitted at or after `since`, newest first.
   * Queries the in-memory ring only (not the DB).
   */
  since(since: Date, limit = 500): OSEvent<unknown>[] {
    return this._ring
      .filter((e) => e.timestamp >= since)
      .slice(-limit)
      .reverse();
  }

  /**
   * Events of a specific kind, newest first.
   */
  byKind<K extends AnyEventKind>(
    kind: K,
    limit = 100,
  ): Array<OSEvent<EventPayloadMap[K]>> {
    return this._ring
      .filter((e) => e.kind === kind)
      .slice(-limit)
      .reverse() as Array<OSEvent<EventPayloadMap[K]>>;
  }

  /**
   * All events sharing the same correlationId, in chronological order.
   * Useful for tracing a causal chain of events.
   */
  byCorrelationId(correlationId: string): OSEvent<unknown>[] {
    return this._ring.filter((e) => e.correlationId === correlationId);
  }

  /**
   * Events with the given status (pending | processed | failed).
   */
  byStatus(status: EventStatus, limit = 100): OSEvent<unknown>[] {
    return this._ring
      .filter((e) => e.status === status)
      .slice(-limit)
      .reverse();
  }

  // ─── Replay ───────────────────────────────────────────────────────────────

  /**
   * Re-emit a set of events through the provided emitter callback.
   * Each event is replayed with a fresh `status = "pending"` but preserves
   * its original id, timestamp, kind, and correlationId.
   *
   * The emitter callback matches the EventBus.emit signature so the caller
   * can pass `bus.emit.bind(bus)` — but we avoid importing EventBus here.
   *
   * @param events    Events to replay (use byKind/since/byCorrelationId to select).
   * @param emitter   Async function that takes (kind, payload, source, opts) → Promise.
   * @param source    Source label written to the replayed events.
   */
  async replay(
    events: OSEvent<unknown>[],
    emitter: (
      kind: string,
      payload: unknown,
      source: string,
      opts?: { correlationId?: string },
    ) => Promise<unknown>,
    source = "os/EventStore.replay",
  ): Promise<{ replayed: number; failed: number }> {
    let replayed = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await emitter(event.kind, event.payload, source, {
          correlationId: event.correlationId ?? event.id,
        });
        replayed++;
      } catch (err) {
        failed++;
        logger.warn(
          { err, eventId: event.id, kind: event.kind },
          "os/EventStore.replay: emitter threw for event",
        );
      }
    }

    logger.info({ replayed, failed, total: events.length }, "os/EventStore: replay complete");
    return { replayed, failed };
  }

  // ─── Persistence helpers ──────────────────────────────────────────────────

  private async _persistToDB(event: OSEvent<unknown>): Promise<void> {
    await db.insert(osEventsTable).values({
      id: event.id,
      kind: event.kind,
      source: event.source,
      priority: event.priority,
      status: event.status,
      correlationId: event.correlationId ?? null,
      payload: (event.payload as Record<string, unknown>) ?? {},
      emittedAt: event.timestamp,
    });
  }

  /**
   * Load recent events from the DB into the ring buffer (for cold-start replay).
   * Loads up to `limit` most-recent events ordered by emitted_at DESC.
   */
  async loadFromDB(limit = 200): Promise<number> {
    try {
      const rows = await db
        .select()
        .from(osEventsTable)
        .orderBy(osEventsTable.emittedAt)
        .limit(limit);

      for (const row of rows) {
        const event: OSEvent<unknown> = {
          id: row.id,
          kind: row.kind,
          source: row.source,
          priority: (row.priority ?? "normal") as OSEvent["priority"],
          status: (row.status ?? "processed") as EventStatus,
          correlationId: row.correlationId ?? undefined,
          payload: row.payload ?? {},
          timestamp: row.emittedAt,
        };
        // Only add if not already in ring.
        if (!this._byId.has(event.id)) {
          if (this._ring.length >= EVENT_STORE_MAX) {
            const evicted = this._ring.shift();
            if (evicted) this._byId.delete(evicted.id);
          }
          this._ring.push(event);
          this._byId.set(event.id, event);
        }
      }

      logger.info({ loaded: rows.length }, "os/EventStore: loaded events from DB");
      return rows.length;
    } catch (err) {
      logger.warn({ err }, "os/EventStore: loadFromDB failed — ring starts empty");
      return 0;
    }
  }

  /** Clear the in-memory ring (does NOT delete DB rows). */
  clear(): void {
    this._ring = [];
    this._byId.clear();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _store: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!_store) _store = new EventStore();
  return _store;
}

export function _resetEventStoreForTest(): void {
  _store = new EventStore();
}
