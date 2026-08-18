import { CRMAdapter, ExternalClient, InspectionPayload } from '../../../types/integration';
import { ssrfSafeFetch } from '../../../lib/ssrf-safe-fetch';

/**
 * PestPac (WorkWave) CRM adapter.
 *
 * Auth: single UUID API key sent as X-WorkWave-Key header.
 * Write operations are async — PestPac returns a requestId immediately
 * and processes the write in the background. pushInspection resolves true
 * once the request is accepted (202), not after the write completes.
 *
 * Env vars (read by getEnvCRMAdapter):
 *   PESTPAC_API_KEY      — UUID from Route Manager → Account Settings → API Integration
 *   PESTPAC_BASE_URL     — defaults to https://api.workwave.com/pestpac/v1
 */
export class PestPacAdapter implements CRMAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private get headers(): Record<string, string> {
    return {
      'X-WorkWave-Key': this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async fetchClients(): Promise<ExternalClient[]> {
    const res = await ssrfSafeFetch(`${this.baseUrl}/customers`, {
      redirect: "error", // never follow redirects — a redirect could point to a private host
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`PestPac fetchClients failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as PestPacCustomer[] | { customers?: PestPacCustomer[] };
    const raw: PestPacCustomer[] = Array.isArray(data) ? data : (data.customers ?? []);

    return raw.map((c) => ({
      id: String(c.id ?? c.customerId),
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || '',
      address: formatPestPacAddress(c),
      serviceNotes: c.notes ?? undefined,
    }));
  }

  async pushInspection(payload: InspectionPayload): Promise<boolean> {
    const body = buildPestPacNote(payload);

    const res = await ssrfSafeFetch(`${this.baseUrl}/customers/${payload.clientId}/notes`, {
      method: 'POST',
      redirect: "error", // never follow redirects — a redirect could point to a private host
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (res.status === 202) {
      return true;
    }

    if (!res.ok) {
      throw new Error(`PestPac pushInspection failed: ${res.status} ${await res.text()}`);
    }

    return true;
  }
}

function formatPestPacAddress(c: PestPacCustomer): string {
  if (c.address) {
    const { street, city, state, zip } = c.address;
    return [street, city, state, zip].filter(Boolean).join(', ');
  }
  return '';
}

function buildPestPacNote(payload: InspectionPayload): Record<string, unknown> {
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
    text: lines.join('\n'),
    type: 'Service',
    referenceId: payload.inspectionId,
    date: new Date(payload.timestamp).toISOString().slice(0, 10),
  };
}

interface PestPacAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface PestPacCustomer {
  id?: number | string;
  customerId?: number | string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  notes?: string;
  address?: PestPacAddress;
}
