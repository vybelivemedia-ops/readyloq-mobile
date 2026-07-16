/**
 * @platform/smart-vision — concrete SmartVisionEventBus implementation.
 * In-process, synchronous, typed event bus.
 */

import type {
  SmartVisionEvent,
  SmartVisionEventBus,
  SmartVisionEventKind,
  SmartVisionEventListener,
} from "../events";

type AnyListener = SmartVisionEventListener<SmartVisionEvent>;

export function createEventBus(): SmartVisionEventBus {
  const listeners = new Map<SmartVisionEventKind, AnyListener[]>();
  const anyListeners: AnyListener[] = [];

  function getList(kind: SmartVisionEventKind): AnyListener[] {
    let list = listeners.get(kind);
    if (!list) { list = []; listeners.set(kind, list); }
    return list;
  }

  return {
    on<K extends SmartVisionEventKind>(
      kind: K,
      listener: SmartVisionEventListener<Extract<SmartVisionEvent, { kind: K }>>,
    ): () => void {
      const list = getList(kind);
      list.push(listener as AnyListener);
      return () => {
        const idx = list.indexOf(listener as AnyListener);
        if (idx >= 0) list.splice(idx, 1);
      };
    },

    onAny(listener: SmartVisionEventListener): () => void {
      anyListeners.push(listener);
      return () => {
        const idx = anyListeners.indexOf(listener);
        if (idx >= 0) anyListeners.splice(idx, 1);
      };
    },

    off(kind: SmartVisionEventKind): void {
      listeners.delete(kind);
    },

    clear(): void {
      listeners.clear();
      anyListeners.length = 0;
    },

    emit(event: SmartVisionEvent): void {
      const list = listeners.get(event.kind);
      if (list) {
        for (const fn of [...list]) {
          try { fn(event); } catch { /* isolate listener errors */ }
        }
      }
      for (const fn of [...anyListeners]) {
        try { fn(event); } catch { /* isolate listener errors */ }
      }
    },
  };
}
