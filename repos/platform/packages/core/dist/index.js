/**
 * @platform/core
 *
 * Universal programming-model primitives. The lowest node in the platform DAG.
 *
 * RULES (enforced by CI lint — see ADR-015):
 *   1. ZERO external dependencies — not even other @platform/* packages.
 *   2. NO domain types — no "inspection", "evidence", "stream", "pest",
 *      "clip", "creator", "property", "agora", or any product-specific string.
 *   3. PURELY structural — interface / type / branded primitive only.
 *      No class implementations. No runtime logic.
 *   4. STABLE API — adding exports is backward-compatible; removing is breaking.
 *
 * CONSUMING PATTERN:
 *   Every other @platform/* package imports from here.
 *   Applications import from domain packages — they should rarely import
 *   @platform/core directly.
 */
export {};
//# sourceMappingURL=index.js.map