import { CRMAdapter, ExternalClient, InspectionPayload } from '../../../types/integration';

export class PestPacAdapter implements CRMAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async fetchClients(): Promise<ExternalClient[]> {
    // TODO: Map PestPac API endpoint for clients/accounts
    console.log('Fetching clients from PestPac...', this.baseUrl);
    return [];
  }

  async pushInspection(payload: InspectionPayload): Promise<boolean> {
    // TODO: Map PestPac API endpoint for posting service notes/reports
    console.log('Pushing inspection report to PestPac...', payload.inspectionId);
    return true;
  }
}
