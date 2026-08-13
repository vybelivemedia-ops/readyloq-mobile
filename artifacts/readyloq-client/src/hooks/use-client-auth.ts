/**
 * Auth hook for the client portal (property managers).
 *
 * Unlike the company portal which checks /api/auth/me + company membership,
 * this portal only needs to confirm that the Clerk user has a row in
 * clientPortalAccessTable. That's returned by /api/client/me.
 */
import { useUser, useClerk } from '@clerk/clerk-react';
import { useClientMe } from './use-client-portal';

export function useClientAuth() {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const meQuery = useClientMe();

  // Consider auth loading while Clerk initializes OR while we're fetching access record
  const loading =
    !isLoaded || (!!isSignedIn && meQuery.isLoading);

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
