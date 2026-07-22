/**
 * @platform/smart-vision/privacy — renderer contracts.
 *
 * The PrivacyRenderer is an optional output stage that takes a frame and
 * a set of masks and produces a visually redacted copy.
 *
 * ORIGINAL MEDIA PRESERVATION:
 *   Original frame → never mutated.
 *   PrivacyMask[]  → instructions derived from the policy.
 *   PrivacyRenderOutput → confirmation that redaction was applied.
 *
 * Applications choose which "layer" to display, upload, or store.
 * The engine passes masks to the renderer; the renderer decides how pixels
 * are modified. Platform contracts stay pixel-format agnostic.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
export {};
