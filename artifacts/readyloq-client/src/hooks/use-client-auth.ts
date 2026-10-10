/**
 * Auth hook for the client portal (property managers).
 *
 * Unlike the company portal which checks /api/auth/me + company membership,
 * this portal only needs to confirm that the Clerk user has a row in
 * clientPortalAccessTable. That's returned by /api/client/me.
 *
 * Key rules:
 * - /api/client/me is only called once Clerk confirms the user is signed in
 *   (enabled guard prevents 401-hang for unauthenticated visitors).
 * - A hard 12-second timeout clears the spinner even if Clerk or the API
 *   stalls — the user lands on /login instead of a permanent white screen.
 */
import { useState, useEffect } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { useClientMe } from './use-client-portal';

const AUTH_TIMEOUT_MS = 12_000;

export function useClientAuth() {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  // Only fetch /api/client/me after Clerk confirms a signed-in session
  const meQuery = useClientMe(!!isSignedIn);

  // Hard timeout: if auth hasn't resolved in AUTH_TIMEOUT_MS, stop waiting.
  // This unblocks the redirect to /login so the user never sees a dead spinner.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), AUTH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  const loading =
    !timedOut && (!isLoaded || (!!isSignedIn && meQuery.isLoading));

  const hasAccess =
    isSignedIn && !meQuery.isError && meQuery.data != null;

  return {
    isLoaded: !loading,
    isSignedIn: !!isSignedIn,
    hasAccess,
    user,
    me: meQuery.data ?? null,
    accessError: meQuery.error,
    signOut: () => clerk.signOut(),
  };
}
