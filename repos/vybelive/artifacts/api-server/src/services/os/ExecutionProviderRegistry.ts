// ─── Mission Control OS Layer — Execution Provider Registry ───────────────────
//
// A typed registry of execution providers available to the OS layer.
// An "execution provider" is anything that can run multi-step autonomous work:
// currently only Agent Zero, but the registry is extensible for future
// providers (e.g. a browser agent, a code-execution sandbox, an external RPA).
//
// Providers self-register via `register()` at startup. The registry is queried
// by Quinn and the OS bootstrap to route `DispatchOptions` to the best
// available provider.
//
// Design rules:
//   • Providers register themselves — the registry never imports them directly.
//     This keeps the dependency graph acyclic (providers → registry, never ←).
//   • `dispatch()` picks the first available provider that supports all
//     required capabilities, then delegates to `provider.dispatch()`.
//   • Errors from providers are caught; callers receive a "rejected" result.

import { logger } from "../../lib/logger.js";
import { getEventBus } from "./EventBus.js";
import type {
  ExecutionProviderDescriptor,
  ExecutionCapability,
  DispatchOptions,
  DispatchResult,
} from "./types.js";

// ─── Provider interface ────────────────────────────────────────────────────────

/**
 * Full interface an execution provider must implement to register with the OS
 * layer. Descriptors describe what the provider is; `dispatch` runs work.
 */
export interface ExecutionProvider extends ExecutionProviderDescriptor {
  /**
   * Dispatch a job. Must return a DispatchResult — never throw.
   * On internal failure, return `{ status: "rejected", reason: "..." }`.
   */
  dispatch(options: DispatchOptions): Promise<DispatchResult>;
}

// ─── ExecutionProviderRegistry class ─────────────────────────────────────────

export class ExecutionProviderRegistry {
  private readonly _providers = new Map<string, ExecutionProvider>();
  private readonly _bus = getEventBus();

  /** Register an execution provider. Safe to call multiple times — last wins. */
  register(provider: ExecutionProvider): void {
    this._providers.set(provider.id, provider);
    logger.info(
      { providerId: provider.id, capabilities: provider.capabilities },
      "os/ExecutionProviderRegistry: provider registered",
    );
  }

  /** Unregister a provider by ID. No-op if not found. */
  unregister(id: string): void {
    this._providers.delete(id);
  }

  /** Look up a registered provider by ID. */
  get(id: string): ExecutionProvider | null {
    return this._providers.get(id) ?? null;
  }

  /** All registered providers (available or not). */
  all(): ExecutionProvider[] {
    return [...this._providers.values()];
  }

  /** Providers that are currently reporting themselves as available. */
  available(): ExecutionProvider[] {
    return this.all().filter((p) => p.isAvailable());
  }

  /** Total registered provider count. */
  get size(): number {
    return this._providers.size;
  }

  /**
   * Find the best available provider for the given required capabilities.
   * Selection: first available provider whose capabilities set is a superset
   * of `required`. Returns null if no match is found.
   */
  selectProvider(required: ExecutionCapability[]): ExecutionProvider | null {
    for (const provider of this.available()) {
      const caps = new Set(provider.capabilities);
      if (required.every((c) => caps.has(c))) return provider;
    }
    return null;
  }

  /**
   * Dispatch a job to the best available provider that supports the required
   * capabilities, or to a specific provider if `options.providerId` is set.
   *
   * Always returns a `DispatchResult` — never throws.
   */
  async dispatch(
    options: DispatchOptions & { providerId?: string; requiredCapabilities?: ExecutionCapability[] },
  ): Promise<DispatchResult> {
    const { providerId, requiredCapabilities = [], ...dispatchOpts } = options;

    // Resolve provider.
    let provider: ExecutionProvider | null = null;
    if (providerId) {
      const explicit = this._providers.get(providerId);
      if (!explicit) {
        return {
          jobId: "",
          providerId: providerId,
          status: "rejected",
          reason: `Provider "${providerId}" is not registered`,
        };
      }
      if (!explicit.isAvailable()) {
        return {
          jobId: "",
          providerId: providerId,
          status: "rejected",
          reason: `Provider "${providerId}" is not currently available`,
        };
      }
      provider = explicit;
    } else {
      provider = this.selectProvider(requiredCapabilities);
    }

    if (!provider) {
      const reason =
        this.available().length === 0
          ? "No execution providers are currently available"
          : `No available provider supports all required capabilities: [${requiredCapabilities.join(", ")}]`;
      logger.warn({ requiredCapabilities }, `os/ExecutionProviderRegistry: ${reason}`);
      return { jobId: "", providerId: "", status: "rejected", reason };
    }

    try {
      const result = await provider.dispatch(dispatchOpts);

      if (result.status === "queued") {
        await this._bus.emit(
          "job.dispatched",
          { jobId: result.jobId, providerId: result.providerId, command: options.command },
          "os/ExecutionProviderRegistry",
        );
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, providerId: provider.id, command: options.command },
        "os/ExecutionProviderRegistry: provider.dispatch threw",
      );
      return {
        jobId: "",
        providerId: provider.id,
        status: "rejected",
        reason: `Provider threw during dispatch: ${msg}`,
      };
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _registry: ExecutionProviderRegistry | null = null;

/** Returns the process-singleton ExecutionProviderRegistry, creating it on first call. */
export function getExecutionProviderRegistry(): ExecutionProviderRegistry {
  if (!_registry) _registry = new ExecutionProviderRegistry();
  return _registry;
}
