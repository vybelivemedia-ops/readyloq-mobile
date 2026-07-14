// ─── Mission Control OS Layer — State Engine ──────────────────────────────────
//
// A lightweight observable key-value store for the OS layer. Components can
// read and write named state slots; listeners fire synchronously on writes so
// derived views (health checks, status endpoints) always see current values.
//
// Design rules:
//   • State is in-memory only — no DB persistence at this layer.
//   • Listeners are called synchronously inside `set()` so callers can rely on
//     ordering. If a listener throws, the error is caught and logged.
//   • `getSnapshot()` returns a shallow copy — mutating it has no effect.
//   • Per-key listener maps are cleaned up when the last listener is removed.

import { logger } from "../../lib/logger.js";
import type {
  OSStateKey,
  OSStateListener,
  OSStateSnapshot,
  OSSubscription,
} from "./types.js";

export class StateEngine {
  private readonly _store = new Map<OSStateKey, unknown>();
  private readonly _listeners = new Map<OSStateKey, Set<OSStateListener<unknown>>>();

  /** Total number of keys currently held. */
  get keyCount(): number {
    return this._store.size;
  }

  /**
   * Read a value. Returns `undefined` if the key has never been set.
   * Cast to the expected type at the call site.
   */
  get<T = unknown>(key: OSStateKey): T | undefined {
    return this._store.get(key) as T | undefined;
  }

  /**
   * Write a value and notify all listeners registered for that key.
   * Listeners receive the new value and the previous value (may be undefined).
   */
  set<T = unknown>(key: OSStateKey, value: T): void {
    const prev = this._store.get(key) as T | undefined;
    this._store.set(key, value);

    const listeners = this._listeners.get(key);
    if (!listeners || listeners.size === 0) return;

    for (const listener of listeners) {
      try {
        (listener as OSStateListener<T>)(value, prev);
      } catch (err) {
        logger.warn(
          { err, key },
          "os/StateEngine: listener threw — swallowing to protect setter",
        );
      }
    }
  }

  /**
   * Delete a key. Listeners for that key are NOT fired — use `set(key, undefined)`
   * first if listeners should observe the deletion.
   */
  delete(key: OSStateKey): void {
    this._store.delete(key);
  }

  /**
   * Subscribe to changes on a specific key.
   * The listener fires on every `set()` call for that key, even if the value
   * is reference-equal to the previous one.
   */
  subscribe<T = unknown>(key: OSStateKey, listener: OSStateListener<T>): OSSubscription {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    const set = this._listeners.get(key)!;
    set.add(listener as OSStateListener<unknown>);

    return {
      unsubscribe: () => {
        set.delete(listener as OSStateListener<unknown>);
        if (set.size === 0) this._listeners.delete(key);
      },
    };
  }

  /**
   * Returns a shallow copy of the entire state store as a plain object.
   * Useful for serialising into a health/status response.
   */
  getSnapshot(): OSStateSnapshot {
    return Object.fromEntries(this._store.entries());
  }

  /**
   * Remove all keys and listeners. Mainly useful in tests.
   */
  clear(): void {
    this._store.clear();
    this._listeners.clear();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _engine: StateEngine | null = null;

/** Returns the process-singleton state engine, creating it on first call. */
export function getStateEngine(): StateEngine {
  if (!_engine) _engine = new StateEngine();
  return _engine;
}

/**
 * Replace the singleton with a fresh instance.
 * Only call this from tests — never from production code.
 */
export function _resetStateEngineForTest(): void {
  _engine = new StateEngine();
}

// ─── Well-known state keys ────────────────────────────────────────────────────
// Centralised constants so components never hard-code key strings.

export const STATE_KEYS = {
  /** Number of objectives currently in_progress. */
  ACTIVE_OBJECTIVE_COUNT: "os.objectives.active_count",
  /** ISO timestamp of the last completed autonomy cycle. */
  LAST_AUTONOMY_CYCLE_AT: "os.autonomy.last_cycle_at",
  /** Whether Agent Zero has healthy workers running. */
  AGENT_ZERO_HEALTHY: "os.agent_zero.healthy",
  /** Number of pending founder approvals. */
  PENDING_APPROVAL_COUNT: "os.approvals.pending_count",
  /** ISO timestamp when the OS layer was initialised. */
  OS_INIT_AT: "os.init_at",
} as const;

export type WellKnownStateKey = (typeof STATE_KEYS)[keyof typeof STATE_KEYS];
