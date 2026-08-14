/**
 * Client Access — lets managers grant / revoke property manager access to the
 * ReadyLoq Commercial & Client Portal (readyloq-client artifact).
 *
 * Uses: POST/GET/DELETE /api/client/invites
 */
import { useState, useCallback } from 'react';
import {
  useClientInvites,
  useGrantAccess,
  useRevokeAccess,
  useCompanyAddresses,
  type ClientAccessRecord,
} from '@/hooks/use-client-access';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  Users,
  Plus,
  Trash2,
  Building2,
  Mail,
  KeyRound,
  Tag,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { format } from 'date-fns';

// ── Grant form ─────────────────────────────────────────────────────────────────

interface GrantFormState {
  clerkUserId: string;
  email: string;
  label: string;
  selectedAddresses: string[];
  addressSearch: string;
}

const emptyForm = (): GrantFormState => ({
  clerkUserId: '',
  email: '',
  label: '',
  selectedAddresses: [],
  addressSearch: '',
});

function GrantDialog({
  open,
  onClose,
  addresses,
}: {
  open: boolean;
  onClose: () => void;
  addresses: string[];
}) {
  const [form, setForm] = useState<GrantFormState>(emptyForm);
  const [showAddressList, setShowAddressList] = useState(false);
  const grant = useGrantAccess();
  const { toast } = useToast();

  const filteredAddresses = addresses.filter(
    (a) =>
      !form.selectedAddresses.includes(a) &&
      a.toLowerCase().includes(form.addressSearch.toLowerCase()),
  );

  const toggleAddress = useCallback(
    (addr: string) => {
      setForm((f) => ({
        ...f,
        selectedAddresses: f.selectedAddresses.includes(addr)
          ? f.selectedAddresses.filter((a) => a !== addr)
          : [...f.selectedAddresses, addr],
      }));
    },
    [],
  );

  const handleSubmit = async () => {
    const userId = form.clerkUserId.trim();
    if (!userId) {
      toast({ title: 'Clerk user ID is required', variant: 'destructive' });
      return;
    }
    if (form.selectedAddresses.length === 0) {
      toast({ title: 'Select at least one building', variant: 'destructive' });
      return;
    }
    try {
      await grant.mutateAsync({
        clerkUserId: userId,
        email: form.email.trim() || undefined,
        label: form.label.trim() || undefined,
        siteAddresses: form.selectedAddresses,
      });
      toast({ title: 'Access granted', description: `${form.selectedAddresses.length} building(s) shared.` });
      setForm(emptyForm());
      onClose();
    } catch (err: any) {
      toast({ title: 'Failed to grant access', description: err.message, variant: 'destructive' });
    }
  };

  const handleClose = () => {
    setForm(emptyForm());
    setShowAddressList(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Grant Client Portal Access
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            The property manager must already have a ReadyLoq account. Find their
            Clerk user ID in the Clerk dashboard under{' '}
            <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">Users</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Clerk user ID */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
              Clerk User ID <span className="text-destructive">*</span>
            </label>
            <Input
              placeholder="user_2abc..."
              value={form.clerkUserId}
              onChange={(e) => setForm((f) => ({ ...f, clerkUserId: e.target.value }))}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Starts with <span className="font-mono">user_</span>. Found in the Clerk dashboard → Users.
            </p>
          </div>

          {/* Email (optional) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              Email <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              type="email"
              placeholder="manager@property.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>

          {/* Label (optional) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-muted-foreground" />
              Label <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              placeholder="Acme Property Management"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>

          {/* Building addresses */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
              Buildings to share <span className="text-destructive">*</span>
            </label>

            {/* Selected chips */}
            {form.selectedAddresses.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 bg-muted/40 rounded-md border border-border">
                {form.selectedAddresses.map((addr) => (
                  <Badge
                    key={addr}
                    variant="secondary"
                    className="cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
                    onClick={() => toggleAddress(addr)}
                    title="Click to remove"
                  >
                    {addr} ×
                  </Badge>
                ))}
              </div>
            )}

            {/* Address picker */}
            <div className="border border-border rounded-md overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors"
                onClick={() => setShowAddressList((v) => !v)}
              >
                <span className="text-muted-foreground">
                  {addresses.length === 0
                    ? 'No buildings found — run inspections first'
                    : 'Search and select buildings…'}
                </span>
                {showAddressList ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </button>

              {showAddressList && (
                <div className="border-t border-border">
                  <div className="p-2">
                    <Input
                      placeholder="Filter addresses…"
                      value={form.addressSearch}
                      onChange={(e) => setForm((f) => ({ ...f, addressSearch: e.target.value }))}
                      className="h-8 text-sm"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredAddresses.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                        {form.addressSearch ? 'No matches' : 'All buildings already selected'}
                      </p>
                    ) : (
                      filteredAddresses.map((addr) => (
                        <button
                          key={addr}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2"
                          onClick={() => {
                            toggleAddress(addr);
                            setForm((f) => ({ ...f, addressSearch: '' }));
                          }}
                        >
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          {addr}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={grant.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={grant.isPending}>
            {grant.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Granting…
              </>
            ) : (
              'Grant Access'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Access record row ──────────────────────────────────────────────────────────

function AccessRow({
  record,
  onRevoke,
}: {
  record: ClientAccessRecord;
  onRevoke: (record: ClientAccessRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-6 py-4 hover:bg-muted/20 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">
              {record.label ?? record.email ?? record.clerkUserId}
            </p>
            {record.label && record.email && (
              <span className="text-xs text-muted-foreground">· {record.email}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{record.clerkUserId}</p>

          {/* Building badges */}
          <div className="mt-2 flex flex-wrap gap-1">
            {(expanded ? record.siteAddresses : record.siteAddresses.slice(0, 3)).map((addr) => (
              <Badge key={addr} variant="outline" className="text-xs font-normal">
                <Building2 className="w-3 h-3 mr-1 text-muted-foreground" />
                {addr}
              </Badge>
            ))}
            {!expanded && record.siteAddresses.length > 3 && (
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => setExpanded(true)}
              >
                +{record.siteAddresses.length - 3} more
              </button>
            )}
            {expanded && record.siteAddresses.length > 3 && (
              <button
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setExpanded(false)}
              >
                Show less
              </button>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-2">
            Granted {format(new Date(record.createdAt), 'MMM d, yyyy')}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive flex-shrink-0"
          title="Revoke access"
          onClick={() => onRevoke(record)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function ClientAccess() {
  const { data: invites = [], isLoading: loadingInvites } = useClientInvites();
  const { data: addresses = [], isLoading: loadingAddresses } = useCompanyAddresses();
  const revoke = useRevokeAccess();
  const { toast } = useToast();

  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ClientAccessRecord | null>(null);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revoke.mutateAsync(revokeTarget.id);
      toast({ title: 'Access revoked', description: `${revokeTarget.label ?? revokeTarget.email ?? revokeTarget.clerkUserId} can no longer sign in to the client portal.` });
      setRevokeTarget(null);
    } catch (err: any) {
      toast({ title: 'Failed to revoke', description: err.message, variant: 'destructive' });
    }
  };

  const isLoading = loadingInvites;

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client Access</h1>
          <p className="text-muted-foreground mt-1">
            Manage which property managers can view building reports in the{' '}
            <span className="text-foreground font-medium">ReadyLoq Commercial & Client Portal</span>.
          </p>
        </div>
        <Button onClick={() => setGrantOpen(true)} className="gap-2 flex-shrink-0">
          <Plus className="w-4 h-4" />
          Grant Access
        </Button>
      </div>

      {/* Info card */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <ExternalLink className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-foreground">How it works</p>
          <p className="text-muted-foreground mt-0.5">
            Property managers sign in at the client portal URL using their existing Google or email
            account. You control which buildings they can see. They only see{' '}
            <strong>approved</strong> reports — drafts remain private.
          </p>
        </div>
      </div>

      {/* Access list */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            Active Access Grants
            {!isLoading && (
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ({invites.length})
              </span>
            )}
          </h2>
        </div>

        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : invites.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-medium text-muted-foreground">No access grants yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click <span className="font-semibold">Grant Access</span> to invite a property manager.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {invites.map((record) => (
              <AccessRow key={record.id} record={record} onRevoke={setRevokeTarget} />
            ))}
          </div>
        )}
      </div>

      {/* Grant dialog */}
      <GrantDialog
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        addresses={addresses}
      />

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(v) => !v && setRevokeTarget(null)}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>
                {revokeTarget?.label ?? revokeTarget?.email ?? revokeTarget?.clerkUserId}
              </strong>{' '}
              will immediately lose access to the client portal and all{' '}
              {revokeTarget?.siteAddresses.length ?? 0} building(s) they could view. This cannot
              be undone — you'll need to re-grant access if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revoke.isPending}
            >
              {revoke.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Revoking…
                </>
              ) : (
                'Yes, revoke'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
