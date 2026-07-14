// ─── Mission Control OS Layer — Quinn Orchestrator (Phase 4) ─────────────────
//
// The Quinn Orchestrator is the OS-layer facade for Quinn's message pipeline.
// Phase 4 upgrades:
//   • classifyIntent() recognises CoS-specific command patterns
//   • respond() emits correct EventBus events (unchanged interface)
//   • getCoSSnapshot() exposes a lightweight status block that conversation
//     handlers can inject into the LLM prompt as situational awareness
//
// The Orchestrator is intentionally thin — it is an observation/routing hook.
// Actual CoS coordination lives in QuinnChiefOfStaff.ts.
// Actual conversation generation lives in chiefConversation.ts / chiefOrchestrator.ts.
//
// NEVER import from `missionControl.ts` route — it imports from services.

import { logger } from "../../lib/logger.js";
import { getEventBus } from "./EventBus.js";
import { getQuinnChiefOfStaff } from "./QuinnChiefOfStaff.js";
import type {
  QuinnIntent,
  QuinnIntentKind,
  QuinnResponse,
  OSAction,
  ChiefOfStaffStatus,
} from "./types.js";

// ─── Intent patterns ───────────────────────────────────────────────────────────
//
// Patterns are tested in order; first match wins.
// CoS-specific patterns are listed before generic commands so they classify
// correctly (e.g. "prioritize objectives" → "command", not "planning").

const COMMAND_PATTERNS: Array<[RegExp, QuinnIntentKind]> = [
  // CoS explicit triggers
  [/\b(?:run|trigger|start)\s+(?:a\s+)?(?:cos|chief.of.staff)\s+cycle\b/i, "command"],
  [/\b(?:assign|reassign)\s+(?:the\s+)?objective\b/i, "command"],
  [/\b(?:escalate|flag)\s+(?:this|the\s+)?(?:issue|objective|blocker)\b/i, "command"],
  [/\b(?:balance|redistribute)\s+(?:the\s+)?workload\b/i, "command"],
  // Generic commands
  [/\b(?:create|start|launch|kick off|begin|open)\s+(?:an?\s+)?objective\b/i, "command"],
  [/\b(?:dispatch|run|execute|trigger)\s+(?:a\s+)?(?:job|task|agent|worker)\b/i, "command"],
  [/\b(?:approve|reject|decide)\s+(?:the\s+)?(?:approval|request)\b/i, "command"],
  // Queries
  [/\b(?:what|how|why|when|where|tell me|explain|show|give me|list|who is|who owns)\b/i, "query"],
  // Planning
  [/\b(?:plan|strategy|roadmap|priorit(?:y|ise|ize)|think about|coordinate)\b/i, "planning"],
];

function classifyIntentRuleBased(message: string): QuinnIntent {
  for (const [pattern, kind] of COMMAND_PATTERNS) {
    if (pattern.test(message)) {
      return { kind, confidence: 72, payload: {} };
    }
  }
  return { kind: "conversation", confidence: 85, payload: {} };
}

// ─── Action extractor ──────────────────────────────────────────────────────────

function extractActions(_text: string, _intent: QuinnIntent): OSAction[] {
  // Phase 4: actions are executed by QuinnChiefOfStaff and the chiefOrchestrator
  // layers, not extracted from free-text. Return noop so the interface is stable.
  return [{ kind: "noop", payload: {} }];
}

// ─── QuinnOrchestrator class ──────────────────────────────────────────────────

export class QuinnOrchestrator {
  private readonly _bus = getEventBus();

  /**
   * Classify the intent of a founder message.
   *
   * Phase 4: rule-based patterns including CoS-specific commands.
   * Returns intent kind + confidence score.
   */
  classifyIntent(message: string): QuinnIntent {
    return classifyIntentRuleBased(message);
  }

  /**
   * Returns a lightweight CoS status snapshot suitable for injecting into
   * LLM prompts as situational awareness context. Zero I/O — reads from the
   * in-memory status on the QuinnChiefOfStaff singleton.
   */
  getCoSSnapshot(): ChiefOfStaffStatus {
    return getQuinnChiefOfStaff().status;
  }

  /**
   * Process a founder message through the Quinn pipeline and emit the
   * correct EventBus events.
   *
   * Phase 4: emits "quinn.message_received" / "quinn.response_sent" with CoS
   * context attached. Real conversation generation is still handled by the
   * chiefConversation / chiefOrchestrator layer invoked from the route.
   *
   * The interface (params + return type) must NOT change across phases.
   */
  async respond(
    founderId: string,
    message: string,
    execId: string,
  ): Promise<QuinnResponse> {
    const cos = this.getCoSSnapshot();

    await this._bus.emit(
      "quinn.message_received",
      {
        founderId,
        execId,
        messageLength: message.length,
      },
      "os/QuinnOrchestrator",
    );

    const intent = this.classifyIntent(message);

    logger.info(
      {
        intentKind: intent.kind,
        confidence: intent.confidence,
        founderId,
        cosBlocked: cos.blockedCount,
        cosCycles: cos.totalCyclesRun,
      },
      "os/QuinnOrchestrator: intent classified (Phase 4)",
    );

    const actions = extractActions("", intent);

    const response: QuinnResponse = {
      text: "", // Filled by the conversation layer (chiefConversation.ts)
      intent,
      actions,
      fromFallback: false,
    };

    await this._bus.emit(
      "quinn.response_sent",
      {
        founderId,
        execId,
        intentKind: intent.kind,
        actionCount: actions.length,
        fromFallback: response.fromFallback,
      },
      "os/QuinnOrchestrator",
    );

    return response;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _orchestrator: QuinnOrchestrator | null = null;

/** Returns the process-singleton QuinnOrchestrator, creating it on first call. */
export function getQuinnOrchestrator(): QuinnOrchestrator {
  if (!_orchestrator) _orchestrator = new QuinnOrchestrator();
  return _orchestrator;
}
