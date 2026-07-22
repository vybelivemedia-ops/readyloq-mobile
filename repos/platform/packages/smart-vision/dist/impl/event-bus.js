/**
 * @platform/smart-vision — concrete SmartVisionEventBus implementation.
 * In-process, synchronous, typed event bus.
 */
export function createEventBus() {
    const listeners = new Map();
    const anyListeners = [];
    function getList(kind) {
        let list = listeners.get(kind);
        if (!list) {
            list = [];
            listeners.set(kind, list);
        }
        return list;
    }
    return {
        on(kind, listener) {
            const list = getList(kind);
            list.push(listener);
            return () => {
                const idx = list.indexOf(listener);
                if (idx >= 0)
                    list.splice(idx, 1);
            };
        },
        onAny(listener) {
            anyListeners.push(listener);
            return () => {
                const idx = anyListeners.indexOf(listener);
                if (idx >= 0)
                    anyListeners.splice(idx, 1);
            };
        },
        off(kind) {
            listeners.delete(kind);
        },
        clear() {
            listeners.clear();
            anyListeners.length = 0;
        },
        emit(event) {
            const list = listeners.get(event.kind);
            if (list) {
                for (const fn of [...list]) {
                    try {
                        fn(event);
                    }
                    catch { /* isolate listener errors */ }
                }
            }
            for (const fn of [...anyListeners]) {
                try {
                    fn(event);
                }
                catch { /* isolate listener errors */ }
            }
        },
    };
}
