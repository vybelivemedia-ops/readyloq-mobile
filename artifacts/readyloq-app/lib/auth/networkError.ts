/**
 * Shared helpers for detecting in-flight network failures during Clerk auth
 * calls and mapping them to a user-friendly offline message.
 *
 * Both sign-in and sign-up import from here so the detection logic and the
 * message string stay in sync.
 */

export const OFFLINE_MESSAGE =
  "No internet connection — check your signal and try again.";

/**
 * Returns true when `err` looks like a mid-request network failure rather
 * than a Clerk validation/business-logic error.  Matches the patterns that
 * React Native's fetch layer, the WhatWG fetch API, and Node's net stack
 * surface when connectivity is lost mid-flight.
 */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as { message?: string }).message ?? String(err);
  return /network|fetch|failed to fetch|no internet|offline|econnrefused|etimedout/i.test(
    msg,
  );
}
