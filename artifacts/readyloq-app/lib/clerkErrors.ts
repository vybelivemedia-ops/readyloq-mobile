/**
 * Extracts a human-friendly message from a Clerk Core v3 error object
 * (which may be a thrown error, a returned `{ error }`, or an Errors bag).
 */
export function clerkErrorMessage(error: unknown): string {
  const fallback = "Something went wrong. Please try again.";
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const e = error as {
    errors?: { longMessage?: string; message?: string }[];
    message?: string;
  };
  if (e.errors?.length) {
    return e.errors[0].longMessage || e.errors[0].message || fallback;
  }
  return e.message || fallback;
}
