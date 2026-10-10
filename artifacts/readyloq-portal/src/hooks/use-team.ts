import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '../config';

// Matches what GET /api/company/members actually returns
export interface CompanyMember {
  id: number;
  clerkUserId: string;
  role: string;
  createdAt: string;
}

export function useCompanyMembers() {
  return useQuery<CompanyMember[]>({
    queryKey: ['company', 'members'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/company/members'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch company members');
      return res.json();
    },
  });
}
