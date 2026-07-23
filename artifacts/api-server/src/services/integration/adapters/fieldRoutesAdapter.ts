import { CRMAdapter, ExternalClient, InspectionPayload } from '../../../types/integration';

/**
 * FieldRoutes CRM adapter.
 *
 * Auth: every request sends both authenticationKey and authenticationToken
 * as request headers (FieldRoutes requires both simultaneously).
 *
 * Env vars (read by getEnvCRMAdapter):
 *   FIELDROUTES_API_KEY      — your authenticationKey from Settings → API Access
 *   FIELDROUTES_API_TOKEN    — your authenticationToken from Settings → API Access
 *   FIELDROUTES_BASE_URL     — defaults to https://api.fieldroutes.com
 *   FIELDROUTES_OFFICE_ID    — numeric office ID (required for search/create calls)
 */
export class FieldRoutesAdapter implements CRMAdapter {
  private apiKey: string;
  private apiToken: string;
  private baseUrl: string;
  private officeId: number;

  constructor(apiKey: string, apiToken: string, baseUrl: string, officeId = 1) {
    this.apiKey = apiKey;
    this.apiToken = apiToken;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.officeId = officeId;
  }

  private get headers(): Record<string, string> {
    return {
      authenticationKey: this.apiKey,
      authenticationToken: this.apiToken,
      'Content-Type': 'application/json',
    };
  }

  async fetchClients(): Promise<ExternalClient[]> {
    const res = await fetch(`${this.baseUrl}/customer/search`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ officeIDs: [this.officeId], status: 1, includeData: 1 }),
    });

    if (!res.ok) {
      throw new Error(`FieldRoutes fetchClients failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { customers?: Record<string, FieldRoutesCustomer> };
    const raw = data.customers ? Object.values(data.customers) : [];

    return raw.map((c) => ({
      id: String(c.customerID),
      name: [c.fname, c.lname].filter(Boolean).join(' '),
      address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(', '),
      serviceNotes: c.serviceNotes ?? undefined,
    }));
  }

  async pushInspection(payload: InspectionPayload): Promise<boolean> {
    const body = buildFieldRoutesNote(payload, this.officeId);

    const res = await fetch(`${this.baseUrl}/note/create`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`FieldRoutes pushInspection failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { success?: boolean; errorMessage?: string };
    if (json.success === false) {
      throw new Error(`FieldRoutes pushInspection error: ${json.errorMessage}`);
    }

    return true;
  }
}

function buildFieldRoutesNote(
  payload: InspectionPayload,
  officeId: number,
): Record<string, unknown> {
  const lines: string[] = [
    `ReadyLoq Inspection — ${new Date(payload.timestamp).toLocaleString()}`,
    '',
  ];

  for (const f of payload.findings) {
    lines.push(`[${f.zone}] ${f.species} — ${f.severity}`);
    if (f.notes) lines.push(`  ${f.notes}`);
  }

  if (payload.mediaUrls.length) {
    lines.push('');
    lines.push('Attached media:');
    payload.mediaUrls.forEach((url) => lines.push(`  ${url}`));
  }

  return {
    officeID: officeId,
    customerID: Number(payload.clientId),
    notes: lines.join('\n'),
    type: 'Service',
    dateAdded: new Date(payload.timestamp).toISOString().slice(0, 10),
    referenceID: payload.inspectionId,
  };
}

interface FieldRoutesCustomer {
  customerID: number;
  fname?: string;
  lname?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  serviceNotes?: string;
}
