import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

export type CurrentUser = {
  id: number;
  clerkUserId: string;
  role: "technician" | "manager";
};

export function useCurrentUser() {
  const { isSignedIn, isLoaded } = useAuth();
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: async (): Promise<CurrentUser> => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
