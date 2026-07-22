/**
 * Extracts a human-friendly message from a Clerk Core v3 error object
 * (which may be a thrown error, a returned `{ error }`, or an Errors bag).
 */

const COLLISION_CODES = new Set([
  "oauth_account_used_by_another_user",
  "external_account_exists",
  "identifier_already_in_use",
  "account_transfer_invalid",
]);

export function clerkErrorMessage(error: unknown): string {
  const fallback = "Something went wrong. Please try again.";
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const e = error as {
    errors?: { code?: string; longMessage?: string; message?: string }[];
    message?: string;
  };
  if (e.errors?.length) {
    const { code, longMessage, message } = e.errors[0];
    if (code && COLLISION_CODES.has(code)) {
      return "This Google account is already linked to a different ReadyLoq account. Try signing in with your email and password instead, or use a different Google account.";
    }
    return longMessage || message || fallback;
  }
  return e.message || fallback;
}
