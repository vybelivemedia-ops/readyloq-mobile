import { CRMAdapter } from '../../types/integration';
import { FieldRoutesAdapter } from './adapters/fieldRoutesAdapter';
import { PestPacAdapter } from './adapters/pestPacAdapter';

const FIELDROUTES_DEFAULT_URL = 'https://api.fieldroutes.com';
const PESTPAC_DEFAULT_URL = 'https://api.workwave.com/pestpac/v1';

// ServSuite is handled by EnterpriseAdapterRouter (sendServSuiteREST) rather
// than the legacy CRMAdapter interface. getCRMAdapter intentionally excludes it
// so callers fall through to the router path.


/**
 * Programmatic factory — useful for per-request or multi-tenant scenarios
 * where credentials come from the database rather than env vars.
 *
 * FieldRoutes requires both apiKey (authenticationKey) and apiToken
 * (authenticationToken). Pass apiToken when provider is 'fieldroutes'.
 */
export function getCRMAdapter(
  provider: 'fieldroutes' | 'pestpac' | 'servsuite',
  apiKey: string,
  baseUrl: string,
  apiToken?: string,
): CRMAdapter {
  switch (provider) {
    case 'fieldroutes': {
      if (!apiToken) throw new Error('FieldRoutes requires apiToken (authenticationToken)');
      const officeId = Number(process.env.FIELDROUTES_OFFICE_ID ?? 1);
      return new FieldRoutesAdapter(apiKey, apiToken, baseUrl, officeId);
    }
    case 'pestpac':
      return new PestPacAdapter(apiKey, baseUrl);
    case 'servsuite':
      // ServSuite uses EnterpriseAdapterRouter.dispatch() directly; this path
      // exists only so the type system accepts 'servsuite' without narrowing.
      throw new Error('ServSuite must be dispatched via EnterpriseAdapterRouter, not getCRMAdapter');
    default:
      throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}

/**
 * Env-var factory — call this anywhere in the server to get a pre-configured
 * adapter. Returns null when no CRM is configured so callers can skip quietly.
 *
 * FieldRoutes env vars:
 *   FIELDROUTES_API_KEY       authenticationKey
 *   FIELDROUTES_API_TOKEN     authenticationToken
 *   FIELDROUTES_BASE_URL      (optional, defaults to https://api.fieldroutes.com)
 *   FIELDROUTES_OFFICE_ID     (optional, defaults to 1)
 *
 * PestPac env vars:
 *   PESTPAC_API_KEY           X-WorkWave-Key UUID
 *   PESTPAC_BASE_URL          (optional, defaults to https://api.workwave.com/pestpac/v1)
 */
export function getEnvCRMAdapter(): CRMAdapter | null {
  if (process.env.FIELDROUTES_API_KEY && process.env.FIELDROUTES_API_TOKEN) {
    return getCRMAdapter(
      'fieldroutes',
      process.env.FIELDROUTES_API_KEY,
      process.env.FIELDROUTES_BASE_URL ?? FIELDROUTES_DEFAULT_URL,
      process.env.FIELDROUTES_API_TOKEN,
    );
  }

  if (process.env.PESTPAC_API_KEY) {
    return getCRMAdapter(
      'pestpac',
      process.env.PESTPAC_API_KEY,
      process.env.PESTPAC_BASE_URL ?? PESTPAC_DEFAULT_URL,
    );
  }

  return null;
}
