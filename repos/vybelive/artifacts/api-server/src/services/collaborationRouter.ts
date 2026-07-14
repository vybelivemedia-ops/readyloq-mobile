// ─── Collaboration Router + Event Generator (V6.4) ────────────────────────────
// V6.4 upgrade: executives now communicate via typed collaboration events rather
// than a single-hop handoff. generateCollabEvents() produces 1-3 typed events
// per executive based on their report findings. routeCollaboration() remains for
// backward-compatible task-handoff orchestration.

import type { CapabilityRole } from "./executiveCapabilities/index.js";

export type CollabRoute = { to: CapabilityRole; reason: string };

const COLLAB_ROUTES: Partial<Record<CapabilityRole, CollabRoute>> = {
  qa_director: {
    to: "cto",
    reason: "QA surfaced a regression or stability risk that needs an engineering fix",
  },
  cto: {
    to: "release_manager",
    reason: "Engineering flagged a change that affects release readiness",
  },
  release_manager: {
    to: "cto",
    reason: "A release-readiness gap needs engineering attention before shipping",
  },
  product_manager: {
    to: "creative_director",
    reason: "A product gap calls for a design response",
  },
  creative_director: {
    to: "marketing_director",
    reason: "A design or brand change needs a coordinated marketing update",
  },
  marketing_director: {
    to: "product_manager",
    reason: "A growth insight needs product prioritization",
  },
};

export type CollaborationTrigger = CollabRoute & { trigger: string };

type RoutableReport = {
  status: string;
  findings: { severity: string; text: string }[];
};

/**
 * Decide whether a source executive's report should trigger a single collaboration
 * hop. Only fires when the report is not healthy (i.e. there is something real to
 * hand off). Returns the target role, the reason, and the specific finding that
 * triggered it, or null when no collaboration is warranted.
 */
export function routeCollaboration(
  sourceRole: string,
  report: RoutableReport,
): CollaborationTrigger | null {
  const route = COLLAB_ROUTES[sourceRole as CapabilityRole];
  if (!route) return null;
  if (report.status === "healthy") return null;

  const flagged =
    report.findings.find((f) => f.severity === "critical") ??
    report.findings.find((f) => f.severity === "warning");
  if (!flagged) return null;

  return { ...route, trigger: flagged.text };
}

// ─── V6.4 Rich Collaboration Event Generation ────────────────────────────────

export type CollabEventType =
  | "ask_assistance"
  | "share_findings"
  | "transfer_task"
  | "request_review"
  | "report_dependency"
  | "update_progress";

export type GeneratedCollabEvent = {
  toRole: CapabilityRole | null; // null = broadcast
  eventType: CollabEventType;
  content: string;
  metadata: Record<string, string>;
};

// Role → roles it naturally communicates with
const PEER_MAP: Partial<Record<CapabilityRole, CapabilityRole[]>> = {
  cto: ["qa_director", "release_manager"],
  qa_director: ["cto", "release_manager"],
  release_manager: ["cto", "product_manager"],
  product_manager: ["creative_director", "marketing_director"],
  creative_director: ["product_manager", "marketing_director"],
  marketing_director: ["product_manager", "creative_director"],
};

const PROGRESS_UPDATES: Partial<Record<CapabilityRole, string[]>> = {
  cto: [
    "Engineering sweep complete — architecture stable. Flagging API surface changes for release review.",
    "Backend systems healthy. Passing infra findings to the team for context.",
  ],
  qa_director: [
    "Quality scan done — test coverage within bounds. Sharing regression summary with engineering.",
    "QA sweep complete. No blocking issues. Release readiness updated.",
  ],
  release_manager: [
    "Release readiness confirmed. Build pipeline green. Sharing version changelog with product.",
    "Deployment gates clear. Notifying engineering and product of release window.",
  ],
  product_manager: [
    "Roadmap audit complete. Priorities aligned with current sprint. Sharing user signal summary.",
    "Product review done. Backlog groomed. Flagging design dependencies for creative team.",
  ],
  creative_director: [
    "Design review complete. Brand assets consistent. Sharing visual spec update with marketing.",
    "Creative audit done. No blocking design gaps. Notifying product of UI readiness.",
  ],
  marketing_director: [
    "Growth analysis complete. Funnel metrics reviewed. Sharing acquisition insights with product.",
    "Marketing sweep done. Campaign alignment confirmed. Passing audience data to product.",
  ],
};

const DEPENDENCY_MESSAGES: Partial<Record<CapabilityRole, Partial<Record<CapabilityRole, string>>>> = {
  qa_director: {
    cto: "QA needs an engineering fix before the next regression run can clear. Blocking test gate until resolved.",
  },
  release_manager: {
    cto: "Release is gated on an engineering change. Cannot advance the build pipeline until the fix lands.",
    qa_director: "Release readiness requires QA sign-off. Waiting on final regression results.",
  },
  product_manager: {
    creative_director: "Feature spec requires design mock-ups before development can begin. Waiting on creative assets.",
  },
  creative_director: {
    marketing_director: "Brand update blocked pending marketing alignment on positioning. Need confirmation before finalizing.",
  },
};

const REVIEW_REQUESTS: Partial<Record<CapabilityRole, Partial<Record<CapabilityRole, string>>>> = {
  cto: {
    release_manager: "Requesting release manager review of API breaking changes before they ship.",
    qa_director: "Requesting QA validation of new service endpoints before promotion.",
  },
  product_manager: {
    creative_director: "Requesting design review of the revised feature spec to ensure UX alignment.",
  },
  marketing_director: {
    product_manager: "Requesting product review of go-to-market positioning to confirm feature accuracy.",
  },
};

/**
 * Generate 1-3 typed collaboration events for an executive after their inspection
 * completes. Deterministic — based on report status, findings, and role topology.
 *
 * Rules:
 * - Always emit an `update_progress` broadcast (all execs need situational awareness)
 * - If critical/warning findings: emit `share_findings` to primary peer
 * - If critical findings: also emit `report_dependency` (blocked until resolved)
 * - If healthy + reviewer exists: occasionally emit `request_review`
 */
export function generateCollabEvents(
  sourceRole: CapabilityRole,
  report: RoutableReport,
  objectiveTitle: string,
): GeneratedCollabEvent[] {
  const events: GeneratedCollabEvent[] = [];
  const criticals = report.findings.filter((f) => f.severity === "critical");
  const warnings = report.findings.filter((f) => f.severity === "warning");
  const peers = PEER_MAP[sourceRole] ?? [];
  const primaryPeer = peers[0] ?? null;

  // 1. Always: broadcast progress update
  const progressMsgs = PROGRESS_UPDATES[sourceRole] ?? [];
  const progressMsg =
    progressMsgs.length > 0
      ? (progressMsgs[objectiveTitle.length % progressMsgs.length] ?? progressMsgs[0]!)
      : `Inspection complete on "${objectiveTitle}". Findings shared with the team.`;
  events.push({
    toRole: null,
    eventType: "update_progress",
    content: progressMsg,
    metadata: { status: report.status, objectiveTitle },
  });

  // 2. Critical or warning findings → share_findings with primary peer
  if ((criticals.length > 0 || warnings.length > 0) && primaryPeer) {
    const topFinding = criticals[0]?.text ?? warnings[0]?.text ?? "Non-trivial findings detected";
    events.push({
      toRole: primaryPeer,
      eventType: "share_findings",
      content: `Sharing findings from the "${objectiveTitle}" sweep: ${topFinding}. This may affect your workstream — please factor it in.`,
      metadata: {
        severity: criticals.length > 0 ? "critical" : "warning",
        finding: topFinding,
        reportStatus: report.status,
      },
    });
  }

  // 3. Critical findings → report_dependency (blocked)
  if (criticals.length > 0 && primaryPeer) {
    const depMsg =
      DEPENDENCY_MESSAGES[sourceRole]?.[primaryPeer] ??
      `${sourceRole.replace(/_/g, " ")} is blocked on a critical finding from "${objectiveTitle}". Need assistance to proceed.`;
    events.push({
      toRole: primaryPeer,
      eventType: "report_dependency",
      content: depMsg,
      metadata: {
        blockedBy: primaryPeer,
        criticalFinding: criticals[0]?.text ?? "critical issue",
      },
    });
  }

  // 4. Healthy + second peer exists → request_review (deterministic, not every time)
  if (report.status === "healthy" && peers.length > 1) {
    const reviewerRole = peers[1]!;
    const reviewMsg = REVIEW_REQUESTS[sourceRole]?.[reviewerRole];
    if (reviewMsg && objectiveTitle.length % 5 !== 0) {
      events.push({
        toRole: reviewerRole,
        eventType: "request_review",
        content: reviewMsg,
        metadata: { requestedBy: sourceRole, context: objectiveTitle },
      });
    }
  }

  return events;
}
