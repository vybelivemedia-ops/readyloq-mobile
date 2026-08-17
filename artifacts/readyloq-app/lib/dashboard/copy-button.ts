/**
 * Pure copy-button logic extracted from executive-dashboard.tsx so it can be
 * unit-tested without a React Native renderer.
 *
 * The component wires these helpers up like so:
 *
 *   <TouchableOpacity
 *     disabled={isCopyButtonDisabled(loading, copying)}
 *     onPress={() => void runCopySnapshot({ getToken, setCopying, setCopyLabel,
 *                                           fetchText, writeClipboard, onError,
 *                                           scheduleReset })}
 *   />
 */

export type CopyLabel = "copy" | "copied";

/**
 * Returns the VoiceOver / TalkBack accessibility label for the copy button.
 *
 * The label must always describe the button's *current* state so that screen
 * readers announce the right thing regardless of the button's visual shape:
 *
 *  - "copy"   (idle / icon-only) → "Copy snapshot"
 *  - "copied" (brief confirmation text) → "Copied!"
 *
 * `copying` (in-flight) keeps the "Copy snapshot" label; the button is
 * disabled so VoiceOver will additionally announce "dimmed".
 */
export function getCopyButtonAccessibilityLabel(
  copying: boolean,
  copyLabel: CopyLabel,
): string {
  if (!copying && copyLabel === "copied") return "Copied!";
  return "Copy snapshot";
}

/**
 * Returns true when the copy button should be inert.
 * Mirrors the `disabled={copying || loading}` prop on the TouchableOpacity.
 */
export function isCopyButtonDisabled(loading: boolean, copying: boolean): boolean {
  return loading || copying;
}

export interface CopySnapshotDeps {
  /** Resolves the current auth token (may be null on anonymous sessions). */
  getToken: () => Promise<string | null>;
  /** Fetches the plain-text executive snapshot. */
  fetchText: (token: string | null) => Promise<{ text: string }>;
  /** Writes a string to the system clipboard. May return boolean (expo-clipboard) or void. */
  writeClipboard: (text: string) => Promise<boolean | void>;
  /** Called to flip the button into its "in-progress" spinner state. */
  setCopying: (v: boolean) => void;
  /** Called to update the button label ("copy" → "copied" → "copy"). */
  setCopyLabel: (v: CopyLabel) => void;
  /**
   * Schedules the label reset back to "copy".
   * Defaults to `(cb) => setTimeout(cb, 2000)` — injectable for tests.
   */
  scheduleReset?: (cb: () => void) => void;
  /** Called when any step throws (e.g. to show an Alert). */
  onError?: (err: unknown) => void;
}

const DEFAULT_DELAY_MS = 2000;

/**
 * Runs the full copy-snapshot flow:
 *   1. Sets `copying = true`
 *   2. Fetches the auth token
 *   3. Fetches the executive text preview
 *   4. Writes it to the clipboard
 *   5. Flips label to "copied", schedules reset after 2 s
 *   6. Always resets `copying = false`
 */
export async function runCopySnapshot(deps: CopySnapshotDeps): Promise<void> {
  const {
    getToken,
    fetchText,
    writeClipboard,
    setCopying,
    setCopyLabel,
    scheduleReset = (cb) => setTimeout(cb, DEFAULT_DELAY_MS),
    onError,
  } = deps;

  setCopying(true);
  try {
    const token = await getToken();
    const { text } = await fetchText(token);
    await writeClipboard(text);
    setCopyLabel("copied");
    scheduleReset(() => setCopyLabel("copy"));
  } catch (e) {
    onError?.(e);
  } finally {
    setCopying(false);
  }
}
