export interface IdentityBriefing<T> { identity: string; value: T | null }

// Render-time identity check prevents even a one-render flash of old context.
export function briefingForIdentity<T>(state: IdentityBriefing<T> | null, identity: string): T | null {
  return state?.identity === identity ? state.value : null;
}
export class PropertyBriefingLoader<T> {
  private generation = 0;
  load(identity: string, fetcher: () => Promise<T | null>, publish: (state: IdentityBriefing<T>) => void) {
    const generation = ++this.generation;
    publish({ identity, value: null });
    let cancelled = false;
    void Promise.resolve().then(fetcher).then(
      (value) => { if (!cancelled && generation === this.generation) publish({ identity, value }); },
      () => { if (!cancelled && generation === this.generation) publish({ identity, value: null }); },
    );
    return () => { cancelled = true; };
  }
}
