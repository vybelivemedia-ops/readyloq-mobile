import { useQuery } from '@tanstack/react-query';
import { useUser, useClerk } from '@clerk/clerk-react';
import { apiUrl } from '../config';

export interface AuthMe {
  effectiveRole: string;
  companyId: number | null;
  isSuperAdmin: boolean;
  betaAccess: boolean;
  company: { id: number; name: string; slug: string } | null;
}

export function useAuth() {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  const meQuery = useQuery<AuthMe>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/auth/me'), { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Not authenticated');
        throw new Error('Failed to fetch auth state');
      }
      return res.json();
    },
    enabled: isLoaded && isSignedIn,
    retry: false,
  });

  const loading = !isLoaded || (!!isSignedIn && meQuery.isLoading);
  const me = meQuery.data;

  return {
    isLoaded: !loading,
    isSignedIn,
    user,
    me,
    signOut: () => clerk.signOut(),
  };
}
