import { apiUrl } from "@/config";

export interface CurrentUser {
  id: number;
  clerkId: string;
  role: string;
  effectiveRole: string;
  isSuperAdmin: boolean;
  companyId: number | null;
}

// A lead is a sales prospect captured from the marketing site. There are two
// kinds: a "demo" request (someone wants a product demo) and a "contact"
// message (general inquiry). Both persist to the platform `leads` table.
export type LeadType = "demo" | "contact";

export interface LeadInput {
  type: LeadType;
  name: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
  role?: string | null;
  teamSize?: string | null;
  message?: string | null;
  source?: string | null;
}

export interface Lead extends LeadInput {
  id: number;
  status: string;
  createdAt: string;
}

// Submit a lead to the API. Throws an Error with a user-friendly message on
// failure so callers can surface it via a toast. Sends no credentials — the
// endpoint is public.
export async function submitLead(input: LeadInput): Promise<Lead> {
  const res = await fetch(apiUrl("/leads"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Response had no JSON body — keep the default message.
    }
    throw new Error(message);
  }

  return (await res.json()) as Lead;
}
