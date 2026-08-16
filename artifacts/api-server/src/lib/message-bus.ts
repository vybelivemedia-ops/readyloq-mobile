/**
 * In-process event bus for real-time portal messaging.
 *
 * Used by SSE endpoints to fan out new messages to all open browser connections
 * for a given (companyId, siteAddress) thread. Each connected client registers
 * a listener; the POST handler emits after a successful DB insert.
 *
 * Scope: single-process only. Sufficient for the current single-instance
 * deployment. For multi-instance scale-out, replace the EventEmitter with a
 * Redis Pub/Sub adapter (same channel-key convention applies).
 *
 * Channel key format: `msg:${companyId}:${siteAddress}`
 * (prefixed to avoid collisions with other future bus events)
 */

import { EventEmitter } from "events";
import type { PortalMessage } from "@workspace/db";

class MessageBus extends EventEmitter {
  /** Derive the channel key for a given thread. */
  channelKey(companyId: number, siteAddress: string): string {
    return `msg:${companyId}:${siteAddress}`;
  }

  /** Emit a new message to all SSE listeners on this thread. */
  publish(message: PortalMessage): void {
    this.emit(this.channelKey(message.companyId, message.siteAddress), message);
  }

  /**
   * Subscribe to new messages on a thread.
   * Returns an unsubscribe function — always call it when the SSE connection closes.
   */
  subscribe(
    companyId: number,
    siteAddress: string,
    listener: (msg: PortalMessage) => void,
  ): () => void {
    const key = this.channelKey(companyId, siteAddress);
    this.on(key, listener);
    return () => this.off(key, listener);
  }
}

// Singleton — imported by both SSE and POST handlers.
export const messageBus = new MessageBus();

// Prevent Node.js MaxListenersExceededWarning: each SSE connection adds one
// listener per thread; with many concurrent connections this can exceed the
// default limit of 10. We set a generous cap that still catches real leaks.
messageBus.setMaxListeners(500);
