"use strict";
/**
 * @platform/smart-vision — real-time operator guidance contracts.
 *
 * The guidance engine evaluates the current vision state and emits generic,
 * domain-neutral directives that tell the operator HOW to improve the shot —
 * not WHAT they are looking for.
 *
 * DOMAIN BOUNDARY:
 *   Platform guidance codes are signal-level observations:
 *     ✓ "move_closer"      — subject occupies too little of the frame
 *     ✓ "hold_steady"      — motion blur detected
 *     ✓ "increase_lighting" — exposure too low
 *     ✓ "subject_left_frame" — tracking lost
 *
 *   NOT platform guidance (application layer):
 *     ✗ "Check under the sink"
 *     ✗ "Look for German roaches"
 *     ✗ "Frame the speaker for the audience"
 *
 *   Applications map GuidanceCode values to domain-specific copy and display
 *   them in the appropriate language and context.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
