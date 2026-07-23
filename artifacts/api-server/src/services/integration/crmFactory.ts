import { CRMAdapter } from '../../types/integration';
import { FieldRoutesAdapter } from './adapters/fieldRoutesAdapter';
import { PestPacAdapter } from './adapters/pestPacAdapter';

export function getCRMAdapter(provider: 'fieldroutes' | 'pestpac', apiKey: string, baseUrl: string): CRMAdapter {
  switch (provider) {
    case 'fieldroutes':
      return new FieldRoutesAdapter(apiKey, baseUrl);
    case 'pestpac':
      return new PestPacAdapter(apiKey, baseUrl);
    default:
      throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}
