/**
 * @platform/smart-vision/privacy — concrete PrivacyHistory implementation.
 *
 * In-memory append-only observation log with O(1) appends and O(n) queries.
 * Suitable for single-session use; for cross-session persistence the application
 * layer serialises via `history.query()` and stores externally.
 */
import type { PrivacyHistory } from "../history";
export declare function createPrivacyHistory(): PrivacyHistory;
//# sourceMappingURL=privacy-history-impl.d.ts.map