/**
 * EquipmentVerifier — FAIE cross-reference module.
 *
 * When the FAIE pipeline detects application equipment (B&G sprayer, bait gun,
 * etc.), this module looks up the technician's daily route assignment for the
 * active target pest and checks whether the detected equipment matches the
 * product's label requirements.
 *
 * This is an advisory check — it produces human-readable feedback that the
 * FAIE handler can speak aloud or display as a status banner.  It never blocks
 * a capture or wizard submission.
 */

import type { RouteAssignment, RouteAssignmentWithProduct } from "@/lib/api-client/daily-route";

// ─── Result types ─────────────────────────────────────────────────────────────

export type VerificationStatus =
  | "confirmed"    // Equipment matches label requirements for the active pest assignment
  | "mismatch"     // Equipment doesn't match label requirements
  | "no_assignment"// No route assignment found for the active pest
  | "no_active_pest" // Active pest is unknown — technician hasn't set a target yet
  | "no_label_data"; // Product found but labelRules are missing

export interface EquipmentVerificationResult {
  status: VerificationStatus;
  /** The canonical equipment name that was detected. */
  detectedEquipment: string;
  /** The active pest at the time of detection. */
  activePest: string | null;
  /** The product the technician is supposed to use for this pest. */
  assignedProductName: string | null;
  /** Required equipment types from the label. */
  labelEquipment: string[] | null;
  /** Human-readable one-liner suitable for TTS or a status banner. */
  message: string;
  /** True when the technician should act on this result (mismatch or missing data). */
  needsAttention: boolean;
}

// ─── Verifier ─────────────────────────────────────────────────────────────────

/**
 * Verifies that the detected equipment is appropriate for the active pest's
 * route assignment.
 *
 * @param detectedEquipment  Canonical equipment name from VocabularyRegistry
 * @param activePest         Currently active pest (from inspection pestTypes or AI analysis)
 * @param routeAssignments   Technician's enriched route assignments for the day
 */
export function verifyEquipmentUsage(
  detectedEquipment: string,
  activePest: string | null,
  routeAssignments: RouteAssignmentWithProduct[],
): EquipmentVerificationResult {
  if (!activePest) {
    return {
      status: "no_active_pest",
      detectedEquipment,
      activePest: null,
      assignedProductName: null,
      labelEquipment: null,
      message: `${detectedEquipment} detected — set a target pest to verify against your route.`,
      needsAttention: false,
    };
  }

  // Find the assignment whose targetPest matches (case-insensitive substring).
  const assignment = routeAssignments.find((a) =>
    a.targetPest.toLowerCase().includes(activePest.toLowerCase()) ||
    activePest.toLowerCase().includes(a.targetPest.toLowerCase()),
  );

  if (!assignment) {
    return {
      status: "no_assignment",
      detectedEquipment,
      activePest,
      assignedProductName: null,
      labelEquipment: null,
      message: `No route assignment for ${activePest}. Check your route plan before applying.`,
      needsAttention: true,
    };
  }

  const productName = assignment.product?.name ?? `Product #${assignment.productId}`;
  const labelEquipment = assignment.product?.labelRules?.requiredEquipmentTypes ?? null;

  if (!labelEquipment || labelEquipment.length === 0) {
    return {
      status: "no_label_data",
      detectedEquipment,
      activePest,
      assignedProductName: productName,
      labelEquipment: null,
      message: `${detectedEquipment} with ${productName} — no equipment requirements on label.`,
      needsAttention: false,
    };
  }

  // Fuzzy match: detected equipment contains any of the label terms, or vice-versa.
  const detected = detectedEquipment.toLowerCase();
  const isMatch = labelEquipment.some(
    (req) =>
      detected.includes(req.toLowerCase()) ||
      req.toLowerCase().includes(detected),
  );

  if (isMatch) {
    return {
      status: "confirmed",
      detectedEquipment,
      activePest,
      assignedProductName: productName,
      labelEquipment,
      message: `${detectedEquipment} confirmed for ${activePest} treatment with ${productName}.`,
      needsAttention: false,
    };
  }

  const requiredStr = labelEquipment.join(" or ");
  return {
    status: "mismatch",
    detectedEquipment,
    activePest,
    assignedProductName: productName,
    labelEquipment,
    message: `Equipment mismatch: ${productName} requires ${requiredStr}, not ${detectedEquipment}. Check label before applying.`,
    needsAttention: true,
  };
}
