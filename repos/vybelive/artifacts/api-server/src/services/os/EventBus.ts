// ─── Mission Control OS Layer — Event Bus (Phase 2) ───────────────────────────
//
// Typed publish/subscribe event bus. Phase 2 upgrades over Phase 1:
//   • Fully typed emit() and subscribe() using EventPayloadMap
//   • Every emitted event carries priority, status, correlationId
//   • Each event is stored in EventStore (in-memory ring + async DB write)
//   • Handler errors are caught, logged, and reflected in event status
//   • Wildcard ("*") subscriptions receive every event regardless of kind
//
// Design rules (unchanged from Phase 1):
//   • Handlers are called in registration order.
//   • Async handlers are awaited sequentially.
//   • Handler errors never crash the emitter.
//   • No persistent storage in this class — EventStore handles that.

import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger.js";
import type { OSEvent, OSEventHandler, EventPriority, OSSubscription } from "./types.js";
import type { EventPayloadMap, AnyEventKind } from "./events/index.js";

const WILDCARD = "*";

type AnyHandler = (event: OSEvent<unknown>) => void | Promise<void>;

// ─── EventBus ─────────────────────────────────────────────────────────────────

export class EventBus {
  private readonly _handlers = new Map<string, Set<AnyHandler>>();
  private _emitCount = 0;

  // Lazily injected to avoid circular construction. Set by initOSLayer().
  private _store: { store(event: OSEvent<unknown>): void } | null = null;

  /** Inject the EventStore so the bus can persist every event. */
  setStore(store: { store(event: OSEvent<unknown>): void }): void {
    this._store = store;
  }

  /** Total events emitted since process start. */
  get emitCount(): number {
    return this._emitCount;
  }

  /** Total active subscriptions (all kinds + wildcard). */
  get subscriptionCount(): number {
    let total = 0;
    for (const set of this._handlers.values()) total += set.size;
    return total;
  }

  // ─── Typed subscribe ────────────────────────────────────────────────────────

  /**
   * Subscribe to a specific event kind with a fully typed handler.
   * Use kind = "*" to receive every event (handler receives OSEvent<unknown>).
   */
  subscribe<K extends AnyEventKind>(
    kind: K,
    handler: OSEventHandler<EventPayloadMap[K]>,
  ): OSSubscription;
  subscribe(
    kind: "*",
    handler: OSEventHandler<unknown>,
  ): OSSubscription;
  subscribe(
    kind: AnyEventKind | "*",
    handler: AnyHandler,
  ): OSSubscription {
    const key = kind as string;
    if (!this._handlers.has(key)) {
      this._handlers.set(key, new Set());
    }
    const set = this._handlers.get(key)!;
    set.add(handler);
    return {
      unsubscribe: () => {
        set.delete(handler);
        if (set.size === 0) this._handlers.delete(key);
      },
    };
  }

  // ─── Typed emit ─────────────────────────────────────────────────────────────

  /**
   * Emit a typed event. Builds the full OSEvent envelope, stores it, then
   * calls all matching handlers (specific kind + wildcard) sequentially.
   * Handler errors are caught and logged but never re-thrown.
   *
   * @returns The fully constructed OSEvent (useful for correlation chaining).
   */
  async emit<K extends AnyEventKind>(
    kind: K,
    payload: EventPayloadMap[K],
    source: string,
    options?: {
      priority?: EventPriority;
      correlationId?: string;
    },
  ): Promise<OSEvent<EventPayloadMap[K]>> {
    this._emitCount++;

    const event: OSEvent<EventPayloadMap[K]> = {
      id: randomUUID(),
      kind,
      timestamp: new Date(),
      payload,
      source,
      priority: options?.priority ?? "normal",
      status: "pending",
      correlationId: options?.correlationId,
    };

    // Persist to EventStore (fire-and-forget from the bus's perspective).
    this._store?.store(event as OSEvent<unknown>);

    // Gather handlers: specific kind + wildcard.
    const specific = this._handlers.get(kind) ?? new Set<AnyHandler>();
    const wildcard = this._handlers.get(WILDCARD) ?? new Set<AnyHandler>();
    const all = [...specific, ...wildcard];

    let handlerError: string | undefined;

    for (const handler of all) {
      try {
        await handler(event as OSEvent<unknown>);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        handlerError = msg;
        logger.warn(
          { err, kind, source, eventId: event.id },
          "os/EventBus: handler threw — swallowing to protect emitter",
        );
      }
    }

    // Update persisted event status after all handlers have run.
    if (this._store && "markProcessed" in this._store) {
      const typedStore = this._store as {
        store(e: OSEvent<unknown>): void;
        markProcessed(id: string, error?: string): void;
      };
      typedStore.markProcessed(event.id, handlerError);
    }

    return event;
  }

  /**
   * Remove all subscriptions for the given kind, or all subscriptions if
   * kind is omitted. Useful in tests.
   */
  clear(kind?: string): void {
    if (kind !== undefined) {
      this._handlers.delete(kind);
    } else {
      this._handlers.clear();
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _bus: EventBus | null = null;

/** Returns the process-singleton EventBus, creating it on first call. */
export function getEventBus(): EventBus {
  if (!_bus) _bus = new EventBus();
  return _bus;
}

export function _resetEventBusForTest(): void {
  _bus = new EventBus();
}
