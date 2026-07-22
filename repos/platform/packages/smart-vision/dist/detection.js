/**
 * @platform/smart-vision — AI detection engine contracts.
 *
 * The detection engine is a pure interface. Applications plug in their own
 * model implementations (pest detection, person tracking, product recognition,
 * sports tracking, structural analysis, etc.). The platform orchestrates
 * inference timing and result routing without knowing what the model detects.
 *
 * GOVERNANCE:
 *   classId values are application-defined integers. The platform NEVER assigns
 *   meaning to them. ClassMapping (classId → label) is always injected from the
 *   application layer. No domain strings appear in this file.
 *   See repos/platform/GOVERNANCE.md.
 */
export {};
