/**
 * Enterprise Integration settings page — owner-only.
 *
 * Lets an owner configure their field-service system (PestPac / FieldRoutes /
 * ServSuite), test the stored credentials, and review recent sync history.
 * Credential fields are write-only: the server never returns the stored key,
 * so the inputs stay blank until the owner types a new value.
 */
import { useEffect, useState } from 'react';
import {
  useIntegrationConfig,
  useSaveIntegrationConfig,
  useDeleteIntegrationConfig,
  useTestConnection,
  useSyncHistory,
  SYSTEM_LABELS,
  type IntegrationSystemType,
  type TestConnectionResult,
} from '@/hooks/use-integrations';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import {
  Loader2,
  Plug,
  CheckCircle2,
  XCircle,
  History,
  Trash2,
  ShieldCheck,
} from 'lucide-react';

export function Integrations() {
  const { toast } = useToast();
  const { data: configRes, isLoading: isLoadingConfig } = useIntegrationConfig();
  const saveConfig = useSaveIntegrationConfig();
  const deleteConfig = useDeleteIntegrationConfig();
  const testConnection = useTestConnection();
  const { data: historyRes, isLoading: isLoadingHistory } = useSyncHistory();

  const existing = configRes?.integration;

  // Form state
  const [systemType, setSystemType] = useState<IntegrationSystemType>('pestpac');
  const [accountId, setAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  // Hydrate non-secret fields from the saved config. Credentials stay blank.
  useEffect(() => {
    if (existing) {
      setSystemType(existing.systemType);
      setAccountId(existing.accountId);
      setApiBaseUrl(existing.apiBaseUrl ?? '');
      setEnabled(existing.enabled);
    }
  }, [existing]);

  const handleSave = async () => {
    if (!accountId.trim()) {
      toast({ title: 'Account ID is required', variant: 'destructive' });
      return;
    }
    if (!apiKey.trim()) {
      toast({
        title: 'API key is required',
        description:
          'For security, saved keys are never displayed — re-enter the key to save changes.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await saveConfig.mutateAsync({
        systemType,
        accountId: accountId.trim(),
        apiKey: apiKey.trim(),
        ...(systemType === 'fieldroutes' && apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
        ...(apiBaseUrl.trim() ? { apiBaseUrl: apiBaseUrl.trim() } : {}),
        enabled,
      });
      setApiKey('');
      setApiToken('');
      setTestResult(null);
      toast({ title: 'Integration saved', description: `${SYSTEM_LABELS[systemType]} settings updated.` });
    } catch (err) {
      toast({
        title: 'Failed to save integration',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      const result = await testConnection.mutateAsync();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        reason: 'network_error',
        message: err instanceof Error ? err.message : 'Test failed',
      });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Remove this integration? Stored credentials will be deleted.')) return;
    try {
      await deleteConfig.mutateAsync();
      setAccountId('');
      setApiKey('');
      setApiToken('');
      setApiBaseUrl('');
      setEnabled(true);
      setTestResult(null);
      toast({ title: 'Integration removed' });
    } catch (err) {
      toast({
        title: 'Failed to remove integration',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const logs = (historyRes?.logs ?? []).slice(0, 20);

  if (isLoadingConfig) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground mt-1">
          Connect ReadyLoq to your field-service management system to sync finalized inspections automatically.
        </p>
      </div>

      {/* Settings card */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Plug className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Connection Settings</h2>
          {existing && (
            <span
              className={`ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                existing.enabled ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'
              }`}
            >
              {existing.enabled ? 'Enabled' : 'Disabled'} — {SYSTEM_LABELS[existing.systemType]}
            </span>
          )}
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="system-type">System</Label>
              <Select value={systemType} onValueChange={(v) => setSystemType(v as IntegrationSystemType)}>
                <SelectTrigger id="system-type">
                  <SelectValue placeholder="Select system" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pestpac">PestPac</SelectItem>
                  <SelectItem value="fieldroutes">FieldRoutes</SelectItem>
                  <SelectItem value="servsuite">ServSuite</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-id">Account ID</Label>
              <Input
                id="account-id"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="Your account / company key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">
                API Key{' '}
                {existing && (
                  <span className="text-xs text-muted-foreground font-normal">(stored — enter to replace)</span>
                )}
              </Label>
              <Input
                id="api-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={existing ? '••••••••  (saved, never displayed)' : 'Enter API key'}
              />
            </div>
            {systemType === 'fieldroutes' && (
              <div className="space-y-2">
                <Label htmlFor="api-token">
                  Authentication Token{' '}
                  {existing?.systemType === 'fieldroutes' && (
                    <span className="text-xs text-muted-foreground font-normal">(stored — enter to replace)</span>
                  )}
                </Label>
                <Input
                  id="api-token"
                  type="password"
                  autoComplete="new-password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="FieldRoutes authenticationToken"
                />
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="api-base-url">
                API Base URL <span className="text-xs text-muted-foreground font-normal">(optional override)</span>
              </Label>
              <Input
                id="api-base-url"
                type="url"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://your-subdomain.example.com"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Switch id="integration-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="integration-enabled" className="cursor-pointer">
              Integration enabled
            </Label>
          </div>

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            Credentials are stored server-side and never sent back to the browser.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
            <Button onClick={handleSave} disabled={saveConfig.isPending} className="mt-3">
              {saveConfig.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testConnection.isPending || !existing}
              className="mt-3"
              title={!existing ? 'Save the integration first' : undefined}
            >
              {testConnection.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Test Connection
            </Button>
            {existing && (
              <Button
                variant="ghost"
                onClick={handleDelete}
                disabled={deleteConfig.isPending}
                className="mt-3 text-destructive hover:text-destructive ml-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove
              </Button>
            )}
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                testResult.ok
                  ? 'border-green-500/30 bg-green-500/10 text-green-500'
                  : 'border-destructive/30 bg-destructive/10 text-destructive'
              }`}
            >
              {testResult.ok ? (
                <>
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Connection successful — credentials verified.</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold">
                      {testResult.reason === 'auth_failed' ? 'Authentication failed' : 'Connection failed'}
                    </span>
                    {testResult.message ? ` — ${testResult.message}` : ''}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sync history */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Sync History</h2>
          <span className="ml-auto text-xs text-muted-foreground">Last 20 syncs</span>
        </div>
        {isLoadingHistory ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No syncs yet. Finalized inspections will appear here once synced.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-6 py-3 font-semibold">Time</th>
                  <th className="px-6 py-3 font-semibold">Inspection</th>
                  <th className="px-6 py-3 font-semibold">System</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-6 py-3 whitespace-nowrap text-muted-foreground">
                      {format(new Date(log.syncedAt), "MMM d, yyyy h:mm a")}
                    </td>
                    <td className="px-6 py-3">
                      <span className="font-medium">{log.siteAddress ?? `Inspection #${log.inspectionId}`}</span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">{SYSTEM_LABELS[log.systemType] ?? log.systemType}</td>
                    <td className="px-6 py-3">
                      {log.success ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500">
                          <CheckCircle2 className="w-3 h-3" /> Success
                        </span>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                            <XCircle className="w-3 h-3" /> Failed
                          </span>
                          {log.errorMessage && (
                            <p className="text-xs text-muted-foreground max-w-md">{log.errorMessage}</p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
