// Pure collaboration-request status transition logic.
//
// Kept free of Express/Drizzle so the permission + status-rule matrix can be
// unit-tested in isolation. The route derives `isSender`/`isRecipient` from the
// persisted row + `req.auth.userId` (never from client input) and passes the
// parsed action here. See collaboration-status-transitions memory for the matrix.

export type CollaborationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "scheduled"
  | "cancelled";

export type CollaborationAction = "accept" | "decline" | "schedule" | "cancel";

export interface TransitionInput {
  status: CollaborationStatus;
  action: CollaborationAction;
  isSender: boolean;
  isRecipient: boolean;
  /** True when a `scheduledAt` value was supplied by the client. */
  scheduledAtProvided: boolean;
  /** True when the supplied `scheduledAt` parsed to a valid date. */
  scheduledAtValid: boolean;
}

export type TransitionResult =
  | { ok: true; newStatus: CollaborationStatus }
  | { ok: false; status: number; error: string };

const TERMINAL: ReadonlySet<CollaborationStatus> = new Set([
  "accepted",
  "declined",
  "cancelled",
]);

/**
 * Resolve the outcome of a collaboration status change.
 *
 * Order of checks mirrors the route so behaviour is identical:
 *  1. caller must be a party to the request
 *  2. cancel is sender-only; accept/decline/schedule are recipient-only
 *  3. terminal states (accepted/declined/cancelled) are final
 *  4. a scheduled request can only be cancelled
 *  5. scheduling requires a valid proposed time
 */
export function resolveCollaborationTransition(input: TransitionInput): TransitionResult {
  const { status, action, isSender, isRecipient } = input;

  if (!isSender && !isRecipient) {
    return { ok: false, status: 403, error: "Not permitted to perform this action" };
  }

  if (action === "cancel" && !isSender) {
    return { ok: false, status: 403, error: "Only the sender can cancel this request" };
  }
  if (action !== "cancel" && !isRecipient) {
    return { ok: false, status: 403, error: "Only the recipient can respond to this request" };
  }

  if (TERMINAL.has(status)) {
    return { ok: false, status: 400, error: "This request can no longer be updated" };
  }
  if (status === "scheduled" && action !== "cancel") {
    return { ok: false, status: 400, error: "This collaboration is already scheduled" };
  }

  switch (action) {
    case "accept":
      return { ok: true, newStatus: "accepted" };
    case "decline":
      return { ok: true, newStatus: "declined" };
    case "cancel":
      return { ok: true, newStatus: "cancelled" };
    case "schedule": {
      if (!input.scheduledAtProvided) {
        return {
          ok: false,
          status: 400,
          error: "A scheduled time is required to schedule a collaboration",
        };
      }
      if (!input.scheduledAtValid) {
        return { ok: false, status: 400, error: "Invalid scheduled time" };
      }
      return { ok: true, newStatus: "scheduled" };
    }
  }
}
