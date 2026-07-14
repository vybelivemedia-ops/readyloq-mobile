// ─── OS Event Bus — Combined EventPayloadMap ──────────────────────────────────
//
// The single source of truth that maps every event kind string to its payload
// type. The EventBus and EventStore use this map to provide type-safe emit()
// and subscribe() calls.
//
// To add a new domain:
//   1. Create events/<domain>.ts with a <Domain>EventMap interface.
//   2. Add it to the EventPayloadMap intersection below.
//   3. Re-export its types here for consumer convenience.
//
// Ordering: alphabetical by domain name.

export type * from "./agentZero.js";
export type * from "./eas.js";
export type * from "./executives.js";
export type * from "./github.js";
export type * from "./missionControl.js";
export type * from "./objectives.js";
export type * from "./readyloq.js";
export type * from "./replit.js";
export type * from "./stripe.js";
export type * from "./vybeLive.js";

import type { AgentZeroEventMap } from "./agentZero.js";
import type { EASEventMap } from "./eas.js";
import type { ExecutivesEventMap } from "./executives.js";
import type { GitHubEventMap } from "./github.js";
import type { MCEventMap } from "./missionControl.js";
import type { ObjectivesEventMap } from "./objectives.js";
import type { ReadyLoqEventMap } from "./readyloq.js";
import type { ReplitEventMap } from "./replit.js";
import type { StripeEventMap } from "./stripe.js";
import type { VYBELiveEventMap } from "./vybeLive.js";

// ─── Quinn / OS internal events ───────────────────────────────────────────────
// Kept here to avoid a separate file for a handful of small payload types.

export interface QuinnEventMap {
  "quinn.message_received": {
    founderId: string;
    execId: string;
    messageLength: number;
  };
  "quinn.response_sent": {
    founderId: string;
    execId: string;
    intentKind: string;
    actionCount: number;
    fromFallback: boolean;
  };
}

export interface OSInternalEventMap {
  "state.changed": {
    key: string;
    value: unknown;
  };
  "autonomy.cycle_started": {
    cycleId: string;
    trigger: "manual" | "scheduled";
  };
  "autonomy.cycle_completed": {
    cycleId: string;
    durationMs: number;
    actionsCount: number;
  };
  "executive.report_ready": {
    executiveId: string;
    role: string;
    objectiveId: string | null;
    status: "healthy" | "attention" | "critical";
  };
}

// ─── Master payload map ───────────────────────────────────────────────────────
// Every known event kind in the system. Extends here as new domains are added.

export interface EventPayloadMap
  extends AgentZeroEventMap,
    EASEventMap,
    ExecutivesEventMap,
    GitHubEventMap,
    MCEventMap,
    ObjectivesEventMap,
    OSInternalEventMap,
    QuinnEventMap,
    ReadyLoqEventMap,
    ReplitEventMap,
    StripeEventMap,
    VYBELiveEventMap {}

/** Union of all known event kind strings. */
export type AnyEventKind = keyof EventPayloadMap;

/** Union of all possible payload types. */
export type AnyEventPayload = EventPayloadMap[AnyEventKind];
