export interface ExternalClient {
  id: string;
  name: string;
  address: string;
  serviceNotes?: string;
}

export interface InspectionPayload {
  inspectionId: string;
  clientId: string;
  timestamp: string;
  findings: Array<{
    zone: string;
    species: string;
    severity: string;
    notes: string;
  }>;
  mediaUrls: string[];
}

export interface CRMAdapter {
  fetchClients(): Promise<ExternalClient[]>;
  pushInspection(payload: InspectionPayload): Promise<boolean>;
}
