/**
 * @platform/smart-vision/privacy — policy contracts.
 *
 * A PrivacyPolicy is a data object — not a class with methods.
 * It describes WHAT to redact (per class) and HOW (redaction type + strength).
 * The engine reads the policy; the policy never drives the engine.
 *
 * Applications configure policies; the platform never hardcodes decisions.
 *
 * GOVERNANCE: No class-specific logic. No application-specific presets.
 * See repos/platform/GOVERNANCE.md.
 */
import type { PrivacyObjectClass } from "./detection";
import type { PrivacyZone } from "./types";
/**
 * How a privacy-sensitive region is visually obscured.
 *
 * "blur_gaussian"      — variable-radius Gaussian blur (soft, natural-looking)
 * "pixelate"           — mosaic pixelation (sharp, stylised)
 * "black_box"          — opaque black rectangle
 * "solid_mask"         — solid rectangle in a configurable colour
 * "transparent_mask"   — semi-transparent overlay (allows partial visibility)
 * "custom"             — delegated to the application's PrivacyRenderer
 * "ai_inpainting"      — reserved for future AI-based object removal
 */
export type RedactionType = "blur_gaussian" | "pixelate" | "black_box" | "solid_mask" | "transparent_mask" | "custom" | "ai_inpainting";
/**
 * Policy decision for a single PrivacyObjectClass.
 *
 * The engine evaluates this per detected object and either produces a
 * PrivacyMask or leaves the region visible.
 */
export interface PrivacyObjectPolicy {
    /** The class this policy applies to. */
    readonly classId: PrivacyObjectClass;
    /**
     * If true, the engine creates a PrivacyMask for every detected instance.
     * If false, the class is intentionally preserved (e.g. structural elements).
     */
    readonly redact: boolean;
    /** Redaction style to apply. Ignored when `redact` is false. */
    readonly redactionType: RedactionType;
    /**
     * Redaction strength 0–1.
     * Blur: 0 = minimal blur, 1 = maximum blur.
     * Pixelate: 0 = small blocks, 1 = large blocks.
     * Solid/transparent masks: 0 = transparent, 1 = fully opaque.
     */
    readonly strength: number;
    /**
     * Per-class confidence threshold override.
     * When omitted, the global PrivacyConfiguration.confidenceThreshold applies.
     */
    readonly confidenceThreshold?: number;
    /**
     * Padding added around the raw detection box, as a fraction of the box
     * dimensions (e.g. 0.1 = 10 % padding on each side).
     * Defaults to 0 when not specified.
     */
    readonly padding?: number;
}
/**
 * The complete redaction policy for a PrivacySession.
 *
 * Applications construct a PrivacyPolicy and pass it to
 * `PrivacyEngine.startSession()`. It can be swapped at runtime via
 * `PrivacySession.updatePolicy()`.
 *
 * DESIGN RULE: PrivacyPolicy is a plain data object.
 * The engine evaluates it — no methods on the policy itself.
 *
 * Example usage (NOT in this file — applications configure this):
 *
 *   ReadyLoq:
 *     redact: person, face, pet, license_plate
 *     preserve: structural objects, measurements, evidence
 *
 *   VYBE:
 *     redact: house_number, address_number, mailbox, document, qr_code
 *     preserve: person, face, vehicle, product, creator
 */
export interface PrivacyPolicy {
    /** Unique policy identifier. Used in events and diagnostics. */
    readonly id: string;
    /** Human-readable name for debugging. Not for end-user display. */
    readonly name: string;
    /**
     * Fallback redaction type applied to any class not listed in `objects`.
     * Default: "blur_gaussian".
     */
    readonly defaultRedactionType: RedactionType;
    /**
     * Fallback strength applied to any class not listed in `objects`.
     * Default: 0.7.
     */
    readonly defaultStrength: number;
    /**
     * Whether classes NOT listed in `objects` should be redacted by default.
     *
     * true  = privacy-first (redact unknown classes)
     * false = evidence-first (preserve unknown classes)
     *
     * ReadyLoq uses false (preserve unknown; explicit list for redaction).
     * A security application might use true (redact unknown; explicit list for preservation).
     */
    readonly redactUnknownClasses: boolean;
    /** Per-class policy entries. Classes not listed here use the defaults above. */
    readonly objects: readonly PrivacyObjectPolicy[];
    /**
     * Static zone overrides applied on every frame regardless of detections.
     * Zones are evaluated after per-object policy decisions.
     */
    readonly zones?: readonly PrivacyZone[];
}
/**
 * Pre-computed lookup map built by the engine at session start.
 * Maps PrivacyObjectClass → PrivacyObjectPolicy for O(1) per-frame access.
 * Internal engine type — not part of the public API.
 */
export type PrivacyPolicyMap = Map<PrivacyObjectClass, PrivacyObjectPolicy>;
//# sourceMappingURL=policy.d.ts.map