/**
 * Pure share-button logic extracted from executive-dashboard.tsx so it can be
 * unit-tested without a React Native renderer.
 *
 * The component wires these helpers up like so:
 *
 *   <TouchableOpacity
 *     disabled={isShareButtonDisabled(loading, sharing)}
 *     onPress={() => void runShareSnapshot({ getToken, checkMailAvailable,
 *                                            fetchEmailPreview, fetchTextPreview,
 *                                            composeEmail, shareText,
 *                                            setSharing, onError })}
 *   />
 */

/**
 * Returns true when the share button should be inert.
 * Mirrors the `disabled={sharing || loading}` prop on the TouchableOpacity.
 */
export function isShareButtonDisabled(loading: boolean, sharing: boolean): boolean {
  return loading || sharing;
}

export interface EmailPreview {
  html: string;
  subject: string;
}

export interface TextPreview {
  text: string;
  subject: string;
}

export interface ShareSnapshotDeps {
  /** Resolves the current auth token (may be null on anonymous sessions). */
  getToken: () => Promise<string | null>;
  /**
   * Returns true when the device's mail client is available (MailComposer path).
   * Injected so tests can force either branch without invoking native modules.
   */
  checkMailAvailable: () => Promise<boolean>;
  /** Fetches the HTML email preview (subject + body). Used on the MailComposer path. */
  fetchEmailPreview: (token: string | null) => Promise<EmailPreview>;
  /** Fetches the plain-text share preview (text + subject). Used as the Share fallback. */
  fetchTextPreview: (token: string | null) => Promise<TextPreview>;
  /**
   * Opens the native mail composer with the HTML preview.
   * Injectable so tests can assert it was called without invoking native UI.
   */
  composeEmail: (opts: { subject: string; body: string; isHtml: boolean }) => Promise<void>;
  /**
   * Opens the native share sheet with the plain-text preview.
   * Injectable so tests can assert it was called without invoking native UI.
   */
  shareText: (opts: { message: string; title: string }) => Promise<void>;
  /** Called to flip the button into its "in-progress" spinner state. */
  setSharing: (v: boolean) => void;
  /** Called when any step throws (e.g. to show an Alert). */
  onError?: (err: unknown) => void;
}

/**
 * Runs the full share-snapshot flow:
 *   1. Sets `sharing = true`
 *   2. Fetches the auth token
 *   3. Checks whether MailComposer is available
 *      a. If yes: fetches the HTML email preview and opens the mail composer
 *      b. If no:  fetches the plain-text preview and opens the share sheet
 *   4. Always resets `sharing = false`
 */
export async function runShareSnapshot(deps: ShareSnapshotDeps): Promise<void> {
  const {
    getToken,
    checkMailAvailable,
    fetchEmailPreview,
    fetchTextPreview,
    composeEmail,
    shareText,
    setSharing,
    onError,
  } = deps;

  setSharing(true);
  try {
    const token = await getToken();
    const mailAvailable = await checkMailAvailable();

    if (mailAvailable) {
      const { html, subject } = await fetchEmailPreview(token);
      await composeEmail({ subject, body: html, isHtml: true });
    } else {
      const { text, subject } = await fetchTextPreview(token);
      await shareText({ message: text, title: subject });
    }
  } catch (e) {
    onError?.(e);
  } finally {
    setSharing(false);
  }
}
