import { describe, it, expect } from "vitest";
import {
  resolveCollaborationTransition,
  type TransitionInput,
} from "./collaborationTransitions";

const base: TransitionInput = {
  status: "pending",
  action: "accept",
  isSender: false,
  isRecipient: true,
  scheduledAtProvided: false,
  scheduledAtValid: false,
};

describe("resolveCollaborationTransition — permissions", () => {
  it("rejects a caller who is neither sender nor recipient", () => {
    const r = resolveCollaborationTransition({
      ...base,
      isSender: false,
      isRecipient: false,
    });
    expect(r).toEqual({ ok: false, status: 403, error: "Not permitted to perform this action" });
  });

  it("only the recipient may accept", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "accept",
      isRecipient: false,
      isSender: true,
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect((r as { error: string }).error).toMatch(/only the recipient/i);
  });

  it("only the recipient may decline", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "decline",
      isRecipient: false,
      isSender: true,
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("only the recipient may schedule", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "schedule",
      isRecipient: false,
      isSender: true,
      scheduledAtProvided: true,
      scheduledAtValid: true,
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("only the sender may cancel", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "cancel",
      isSender: false,
      isRecipient: true,
    });
    expect(r).toEqual({ ok: false, status: 403, error: "Only the sender can cancel this request" });
  });

  it("the sender may cancel a pending request", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "cancel",
      isSender: true,
      isRecipient: false,
    });
    expect(r).toEqual({ ok: true, newStatus: "cancelled" });
  });
});

describe("resolveCollaborationTransition — status rules", () => {
  it("accepts a pending request (recipient)", () => {
    expect(resolveCollaborationTransition({ ...base, action: "accept" })).toEqual({
      ok: true,
      newStatus: "accepted",
    });
  });

  it("declines a pending request (recipient)", () => {
    expect(resolveCollaborationTransition({ ...base, action: "decline" })).toEqual({
      ok: true,
      newStatus: "declined",
    });
  });

  for (const status of ["accepted", "declined", "cancelled"] as const) {
    it(`treats ${status} as terminal`, () => {
      const r = resolveCollaborationTransition({ ...base, status, action: "accept" });
      expect(r).toEqual({ ok: false, status: 400, error: "This request can no longer be updated" });
    });
  }

  it("a scheduled request cannot be re-accepted", () => {
    const r = resolveCollaborationTransition({ ...base, status: "scheduled", action: "accept" });
    expect(r).toEqual({
      ok: false,
      status: 400,
      error: "This collaboration is already scheduled",
    });
  });

  it("a scheduled request can still be cancelled by the sender", () => {
    const r = resolveCollaborationTransition({
      ...base,
      status: "scheduled",
      action: "cancel",
      isSender: true,
      isRecipient: false,
    });
    expect(r).toEqual({ ok: true, newStatus: "cancelled" });
  });
});

describe("resolveCollaborationTransition — schedule time validation", () => {
  it("requires a proposed time to schedule", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "schedule",
      scheduledAtProvided: false,
      scheduledAtValid: false,
    });
    expect(r).toEqual({
      ok: false,
      status: 400,
      error: "A scheduled time is required to schedule a collaboration",
    });
  });

  it("rejects an invalid proposed time", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "schedule",
      scheduledAtProvided: true,
      scheduledAtValid: false,
    });
    expect(r).toEqual({ ok: false, status: 400, error: "Invalid scheduled time" });
  });

  it("schedules with a valid proposed time (recipient)", () => {
    const r = resolveCollaborationTransition({
      ...base,
      action: "schedule",
      scheduledAtProvided: true,
      scheduledAtValid: true,
    });
    expect(r).toEqual({ ok: true, newStatus: "scheduled" });
  });
});
