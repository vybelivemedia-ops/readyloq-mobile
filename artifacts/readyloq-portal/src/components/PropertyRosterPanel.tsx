import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPropertyRoster, addPropertyLocation, updatePropertyLocation, listPropertyVisits,
  createPropertyVisit, getPropertyVisitCoverage, updatePropertyCoverage,
} from '@workspace/api-client-react';
import type { PropertyLocationKind, PropertyLocationRecord, PropertyCoverageRecord, PropertyCoverageState } from '@workspace/api-client-react';
import { Loader2, X } from 'lucide-react';

const KINDS: PropertyLocationKind[] = ['building', 'floor', 'unit', 'common_area'];
const STATES: PropertyCoverageState[] = ['not_inspected', 'in_progress', 'inspected', 'no_access'];

export const rosterKeys = {
  roster: (cid: number | string, pid: number) => ['property-foundation', cid, pid, 'roster'] as const,
  visits: (cid: number | string, pid: number) => ['property-foundation', cid, pid, 'visits'] as const,
  visit: (cid: number | string, pid: number, vid: string) => ['property-foundation', cid, pid, 'visit', vid] as const,
};

export function describeOpError(e: unknown): string {
  const err = e as { status?: number; message?: string } | undefined;
  if (err?.status === 403) return 'You do not have permission for this property (scope denied).';
  if (err?.status === 409) return 'Conflict: this record changed elsewhere. Refresh and try again.';
  return err?.message || 'Operation failed.';
}

interface Props { propertyId: number | null | undefined; companyId?: number | string; userId?: string; siteAddress: string; onClose: () => void }

export function PropertyRosterPanel({ propertyId, companyId = 'self', userId, siteAddress, onClose }: Props) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [kind, setKind] = useState<PropertyLocationKind>('unit');
  const [label, setLabel] = useState('');
  const [parentId, setParentId] = useState('');
  const [areaType, setAreaType] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [covDraft, setCovDraft] = useState<Record<string, { state: PropertyCoverageState; inspectionId: string; reason: string }>>({});

  const pid = propertyId ?? 0;
  const identity = JSON.stringify([userId, companyId]);
  const enabled = !!propertyId && !!userId && typeof companyId === 'number';
  const roster = useQuery({ queryKey: rosterKeys.roster(identity, pid), queryFn: () => getPropertyRoster(pid), enabled, refetchInterval: 30000 });
  const visits = useQuery({ queryKey: rosterKeys.visits(identity, pid), queryFn: () => listPropertyVisits(pid), enabled, refetchInterval: 30000 });
  const visitList = visits.data;
  const activeVisitId = visitId && visitList?.some((v) => v.id === visitId) ? visitId : null;
  const coverage = useQuery({
    queryKey: rosterKeys.visit(identity, pid, activeVisitId ?? 'none'),
    queryFn: () => getPropertyVisitCoverage(pid, activeVisitId as string),
    enabled: enabled && !!activeVisitId && !roster.isError,
    refetchInterval: 30000,
  });

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['property-foundation', identity, pid] });
  const onErr = (e: unknown) => { setError(describeOpError(e)); invalidateAll(); };
  const onOk = () => { setError(null); invalidateAll(); };

  const add = useMutation({
    mutationFn: () => addPropertyLocation(pid, {
      id: crypto.randomUUID(), kind, label,
      parentId: parentId || null,
      ...(kind === 'common_area' && areaType ? { commonAreaType: areaType } : {}),
    }),
    onSuccess: () => { setLabel(''); setAreaType(''); onOk(); }, onError: onErr,
  });
  const update = useMutation({
    mutationFn: (a: { loc: PropertyLocationRecord; body: Omit<Parameters<typeof updatePropertyLocation>[2], 'revision'> }) =>
      updatePropertyLocation(pid, a.loc.id, { revision: a.loc.revision, ...a.body }),
    onSuccess: () => { setEditing(null); setArchiving(null); setArchiveReason(''); onOk(); }, onError: onErr,
  });
  const newVisit = useMutation({
    mutationFn: () => createPropertyVisit(pid, crypto.randomUUID()),
    onSuccess: (r) => { setVisitId(r.visit.id); onOk(); }, onError: onErr,
  });
  const setCov = useMutation({
    mutationFn: (a: { c: PropertyCoverageRecord; state: PropertyCoverageState; inspectionId?: number; reason?: string }) =>
      updatePropertyCoverage(pid, a.c.visitId, a.c.id, {
        revision: a.c.revision, state: a.state,
        ...(a.inspectionId != null ? { inspectionId: a.inspectionId } : {}),
        ...(a.reason ? { reason: a.reason } : {}),
      }),
    onSuccess: onOk, onError: onErr,
  });

  if (!propertyId) {
    return (
      <Shell address={siteAddress} onClose={onClose}>
        <p data-testid="text-roster-no-profile" className="text-sm text-muted-foreground">
          This property has no saved property profile. Save the existing property profile first; the roster attaches to the profile, not the address.
        </p>
      </Shell>
    );
  }
  if (!enabled || roster.isError) {
    return <Shell address={siteAddress} onClose={onClose}>
      <p role="alert">{roster.isError ? describeOpError(roster.error) : 'Waiting for authenticated company context.'}</p>
    </Shell>;
  }

  const locs = roster.data?.locations ?? [];
  const byId = new Map(locs.map((l) => [l.id, l]));
  const children = (p: string | null) => locs.filter((l) => (l.parentId ?? null) === p);
  const parentOptions = locs.filter((l) => !l.archivedAt && (l.kind === 'building' || l.kind === 'floor'));

  const renderLoc = (l: PropertyLocationRecord, depth: number): React.ReactElement => {
    const parent = l.parentId ? byId.get(l.parentId) : null;
    const blocked = !!l.archivedAt && !!parent?.archivedAt;
    return (
      <div key={l.id}>
        <div data-testid={`row-location-${l.id}`} className="flex flex-wrap items-center gap-2 py-1.5 text-sm" style={{ paddingLeft: depth * 16 }}>
          <span className="text-xs uppercase text-muted-foreground w-24 shrink-0">{l.kind.replace('_', ' ')}</span>
          {editing === l.id ? (
            <>
              <input data-testid={`input-edit-label-${l.id}`} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="border border-border rounded px-2 py-1 bg-background" />
              <select data-testid={`select-edit-parent-${l.id}`} defaultValue={l.parentId ?? ''} id={`parent-${l.id}`} className="border border-border rounded px-2 py-1 bg-background">
                <option value="">No parent</option>
                {parentOptions.filter((p) => p.id !== l.id).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <button data-testid={`button-save-location-${l.id}`} disabled={update.isPending || !editLabel.trim()} className="text-xs text-primary font-medium"
                onClick={() => {
                  const sel = (document.getElementById(`parent-${l.id}`) as HTMLSelectElement).value;
                  update.mutate({ loc: l, body: { label: editLabel, parentId: sel || null } });
                }}>Save</button>
              <button onClick={() => setEditing(null)} className="text-xs text-muted-foreground">Cancel</button>
            </>
          ) : (
            <>
              <span className={l.archivedAt ? 'line-through text-muted-foreground' : 'font-medium'}>{l.label}</span>
              {l.archivedAt && <span className="text-xs text-muted-foreground">archived</span>}
              {!l.archivedAt && <button data-testid={`button-edit-location-${l.id}`} className="text-xs text-primary" onClick={() => { setEditing(l.id); setEditLabel(l.label); }}>Edit</button>}
              {!l.archivedAt && <button data-testid={`button-archive-location-${l.id}`} className="text-xs text-destructive" onClick={() => setArchiving(l.id)}>Archive</button>}
              {l.archivedAt && (
                <button data-testid={`button-restore-location-${l.id}`} disabled={blocked || update.isPending}
                  title={blocked ? 'Restore the archived parent first' : undefined}
                  className="text-xs text-primary disabled:opacity-40"
                  onClick={() => update.mutate({ loc: l, body: { archived: false } })}>Restore</button>
              )}
            </>
          )}
        </div>
        {archiving === l.id && (
          <div className="flex gap-2 items-center py-1 text-sm" style={{ paddingLeft: depth * 16 + 24 }}>
            <input data-testid={`input-archive-reason-${l.id}`} placeholder="Reason (archives all children)" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} className="border border-border rounded px-2 py-1 bg-background flex-1" />
            <button data-testid={`button-confirm-archive-${l.id}`} disabled={!archiveReason.trim() || update.isPending} className="text-xs text-destructive font-medium disabled:opacity-40"
              onClick={() => update.mutate({ loc: l, body: { archived: true, reason: archiveReason.trim() } })}>Confirm</button>
            <button onClick={() => setArchiving(null)} className="text-xs text-muted-foreground">Cancel</button>
          </div>
        )}
        {children(l.id).map((c) => renderLoc(c, depth + 1))}
      </div>
    );
  };

  return (
    <Shell address={siteAddress} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Roster and coverage edits need a connection; offline roster editing and preloading downloaded rosters are not available yet.
      </p>
      {error && <div role="alert" data-testid="text-roster-error" className="text-sm text-destructive bg-destructive/10 rounded p-2">{error}</div>}

      <section className="space-y-2">
        <h3 className="font-semibold text-sm">Roster</h3>
        {roster.isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {roster.data && !locs.length && <p data-testid="text-roster-empty" className="text-sm text-muted-foreground">No locations yet. Add a building, floor, unit or common area.</p>}
        {children(null).map((l) => renderLoc(l, 0))}
        {locs.filter((l) => l.parentId && !byId.has(l.parentId)).map((l) => renderLoc(l, 0))}
        <form className="flex flex-wrap gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) add.mutate(); }}>
          <select data-testid="select-location-kind" value={kind} onChange={(e) => setKind(e.target.value as PropertyLocationKind)} className="border border-border rounded px-2 py-1.5 text-sm bg-background">
            {KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </select>
          <input data-testid="input-location-label" placeholder="Label (e.g. 12A)" value={label} onChange={(e) => setLabel(e.target.value)} className="border border-border rounded px-2 py-1.5 text-sm bg-background" />
          <select data-testid="select-location-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} className="border border-border rounded px-2 py-1.5 text-sm bg-background">
            <option value="">No parent</option>
            {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {kind === 'common_area' && <select aria-label="Common area type" data-testid="input-common-area-type" value={areaType} onChange={(e) => setAreaType(e.target.value)} required className="border border-border rounded px-2 py-1.5 text-sm bg-background">
            <option value="">Select area type</option>
            {['basement', 'lobby', 'hallway', 'stairwell', 'mechanical_room', 'trash_room', 'exterior', 'other'].map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
          </select>}
          <button data-testid="button-add-location" type="submit" disabled={add.isPending || !label.trim()} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">Add</button>
        </form>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Visit coverage</h3>
          <button data-testid="button-new-visit" disabled={newVisit.isPending} onClick={() => newVisit.mutate()} className="px-3 py-1.5 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20">Start visit</button>
        </div>
        <p className="text-xs text-muted-foreground">A visit snapshots active units and common areas (not buildings or floors); all start as not inspected. Coverage does not represent evidence sync, and states are never inferred.</p>
        {visits.isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {visits.isError && <div className="text-sm text-destructive">{describeOpError(visits.error)} <button className="underline" onClick={() => visits.refetch()}>Retry</button></div>}
        {visitList && !visitList.length && <p className="text-sm text-muted-foreground" data-testid="text-visits-empty">No visits yet.</p>}
        {!!visitList?.length && (
          <select data-testid="select-visit" value={activeVisitId ?? ''} onChange={(e) => setVisitId(e.target.value || null)} className="border border-border rounded px-2 py-1.5 text-sm bg-background">
            <option value="">Select a visit</option>
            {visitList.map((v) => <option key={v.id} value={v.id}>{new Date(v.createdAt).toLocaleString()}</option>)}
          </select>
        )}
        {activeVisitId && coverage.isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {activeVisitId && coverage.isError && <div className="text-sm text-destructive">{describeOpError(coverage.error)} <button className="underline" onClick={() => coverage.refetch()}>Retry</button></div>}
        {activeVisitId && coverage.data?.visit.id === activeVisitId && coverage.data.coverage.map((c) => {
          const d = covDraft[c.id] ?? { state: c.state, inspectionId: c.inspectionId?.toString() ?? '', reason: c.reason ?? '' };
          const needsInsp = d.state === 'inspected' || d.state === 'in_progress';
          const insp = Number(d.inspectionId);
          const valid = d.state === 'not_inspected' || (needsInsp ? Number.isInteger(insp) && insp > 0 : d.state === 'no_access' ? !!d.reason.trim() : true);
          const set = (p: Partial<typeof d>) => setCovDraft((s) => ({ ...s, [c.id]: { ...d, ...p } }));
          return (
            <div key={c.id} data-testid={`row-coverage-${c.id}`} className="flex flex-wrap items-center gap-2 text-sm border-b border-border py-2">
              <div className="min-w-40">
                <div className="font-medium">{c.snapshot.label}</div>
                <div className="text-xs text-muted-foreground">{c.snapshot.ancestors.map((a) => a.label).join(' / ') || c.snapshot.kind.replace('_', ' ')}</div>
              </div>
              <span data-testid={`status-coverage-${c.id}`} className="text-xs px-2 py-0.5 rounded bg-muted">{c.state.replace('_', ' ')}</span>
              <select data-testid={`select-coverage-state-${c.id}`} value={d.state} onChange={(e) => set({ state: e.target.value as PropertyCoverageState })} className="border border-border rounded px-2 py-1 bg-background">
                {STATES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              {needsInsp && <input data-testid={`input-coverage-inspection-${c.id}`} inputMode="numeric" placeholder="Inspection ID" value={d.inspectionId} onChange={(e) => set({ inspectionId: e.target.value })} className="border border-border rounded px-2 py-1 w-28 bg-background" />}
              {d.state === 'no_access' && <input data-testid={`input-coverage-reason-${c.id}`} placeholder="Reason" value={d.reason} onChange={(e) => set({ reason: e.target.value })} className="border border-border rounded px-2 py-1 bg-background" />}
              <button data-testid={`button-save-coverage-${c.id}`} disabled={!valid || setCov.isPending} className="text-xs text-primary font-medium disabled:opacity-40"
                onClick={() => setCov.mutate({ c, state: d.state, inspectionId: needsInsp ? insp : undefined, reason: d.state === 'no_access' ? d.reason.trim() : undefined })}>Save</button>
            </div>
          );
        })}
        {activeVisitId && coverage.data && !coverage.data.coverage.length && <p className="text-sm text-muted-foreground">This visit has no units or common areas.</p>}
      </section>
    </Shell>
  );
}

function Shell({ address, onClose, children }: { address: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div data-testid="panel-property-roster" className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Roster and coverage: {address}</h2>
        <button data-testid="button-close-roster" onClick={onClose} aria-label="Close roster"><X className="w-4 h-4" /></button>
      </div>
      {children}
    </div>
  );
}
