export interface InspectionIngestQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}

/**
 * Serializes durable photo work for one inspection while allowing callers to
 * render optimistic thumbnails before enqueueing.
 */
export function createInspectionIngestQueue(): InspectionIngestQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    async drain(): Promise<void> {
      // An external camera source may enqueue while a caller is awaiting the
      // current tail. Keep draining until no newer tail was installed.
      let observed: Promise<void>;
      do {
        observed = tail;
        await observed;
      } while (observed !== tail);
    },
  };
}