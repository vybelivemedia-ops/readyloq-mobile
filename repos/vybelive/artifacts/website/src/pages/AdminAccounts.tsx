import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTitle } from "@/hooks/use-title";
import { format } from "date-fns";
import { RefreshCw, RotateCcw, XCircle, CheckCircle2 } from "lucide-react";

type Tab = "active" | "suspended" | "pending_deletion" | "requests" | "audit";

interface LifecycleAccount {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: string;
  plan?: string;
  accountStatus: string;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  deletionRequestedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

interface DeletionRequest {
  id: string;
  userId: string | null;
  email: string;
  username: string | null;
  reason: string | null;
  source: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  actorType: string;
  ipAddress: string | null;
  metadata: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500/10 text-green-400 border-green-700/30",
  suspended: "bg-amber-500/10 text-amber-400 border-amber-700/30",
  pending_deletion: "bg-red-500/10 text-red-400 border-red-700/30",
  deleted: "bg-zinc-500/10 text-zinc-400 border-zinc-700/30",
  pending: "bg-amber-500/10 text-amber-400 border-amber-700/30",
  completed: "bg-zinc-500/10 text-zinc-400 border-zinc-700/30",
  cancelled: "bg-green-500/10 text-green-400 border-green-700/30",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-secondary text-white border-border";
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function fmt(d: string | null): string {
  return d ? format(new Date(d), "MMM d, yyyy · h:mm a") : "—";
}

const TABS: { key: Tab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
  { key: "pending_deletion", label: "Pending Deletion" },
  { key: "requests", label: "Deletion Requests" },
  { key: "audit", label: "Audit Logs" },
];

export default function AdminAccounts() {
  useTitle("Admin — Accounts");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [tab, setTab] = useState<Tab>("active");
  const [accounts, setAccounts] = useState<LifecycleAccount[]>([]);
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  async function api(path: string, jwt: string, init?: RequestInit) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setLoginError((body as { error?: string }).error ?? "Login failed.");
        return;
      }
      const jwt = (body as { accessToken?: string }).accessToken;
      if (!jwt) {
        setLoginError("No access token returned.");
        return;
      }
      setToken(jwt);
      await loadTab(tab, jwt);
    } catch {
      setLoginError("Network error.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function loadTab(which: Tab, jwt: string) {
    setLoading(true);
    setLoadError(null);
    setActionMsg(null);
    try {
      if (which === "requests") {
        const { res, body } = await api(`/api/admin/deletion-requests?limit=200`, jwt);
        if (!handleAuth(res, body)) return;
        setRequests((body as { requests: DeletionRequest[] }).requests);
        setTotal((body as { total: number }).total);
      } else if (which === "audit") {
        const { res, body } = await api(`/api/admin/audit-logs?limit=200`, jwt);
        if (!handleAuth(res, body)) return;
        setLogs((body as { logs: AuditLog[] }).logs);
        setTotal((body as { total: number }).total);
      } else {
        const { res, body } = await api(`/api/admin/accounts?status=${which}&limit=200`, jwt);
        if (!handleAuth(res, body)) return;
        setAccounts((body as { accounts: LifecycleAccount[] }).accounts);
        setTotal((body as { total: number }).total);
      }
    } catch {
      setLoadError("Network error loading data.");
    } finally {
      setLoading(false);
    }
  }

  function handleAuth(res: Response, body: unknown): boolean {
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) {
      setLoadError("Access denied — admin role required.");
      setToken(null);
    } else {
      setLoadError((body as { error?: string }).error ?? "Failed to load data.");
    }
    return false;
  }

  function switchTab(which: Tab) {
    setTab(which);
    if (token) loadTab(which, token);
  }

  async function doAction(path: string, successMsg: string) {
    if (!token) return;
    setActionMsg(null);
    const { res, body } = await api(path, token, { method: "POST" });
    if (!res.ok) {
      setActionMsg((body as { error?: string }).error ?? "Action failed.");
      return;
    }
    setActionMsg(successMsg);
    await loadTab(tab, token);
  }

  function handleLogout() {
    setToken(null);
    setAccounts([]);
    setRequests([]);
    setLogs([]);
    setTotal(0);
    setEmail("");
    setPassword("");
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="font-display font-black text-2xl text-white">VYBE<span className="text-primary">LIVE</span></h1>
            <p className="text-muted-foreground mt-2 text-sm">Admin — Accounts &amp; Lifecycle</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4 bg-card border border-border rounded-2xl p-6">
            <div className="space-y-1.5">
              <Label htmlFor="adm-email">Admin Email</Label>
              <Input id="adm-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" className="bg-background border-border" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adm-pass">Password</Label>
              <Input id="adm-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-background border-border" />
            </div>
            {loginError && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">{loginError}</p>
            )}
            <Button type="submit" disabled={loginLoading} className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-bold rounded-full">
              {loginLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 px-6 py-4 flex items-center justify-between">
        <h1 className="font-display font-black text-xl text-white">
          VYBE<span className="text-primary">LIVE</span>{" "}
          <span className="text-muted-foreground font-sans font-normal text-base">/ Admin / Accounts</span>
        </h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => token && loadTab(tab, token)} disabled={loading} className="rounded-full border-border gap-2">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Refresh"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="rounded-full text-muted-foreground">Sign Out</Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                tab === t.key
                  ? "bg-primary text-white border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mb-4 flex items-center justify-between">
          <p className="text-muted-foreground text-sm">{total} record{total !== 1 ? "s" : ""}</p>
        </div>

        {actionMsg && (
          <div className="bg-secondary/40 border border-border rounded-xl px-4 py-3 text-white mb-4 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-400" /> {actionMsg}
          </div>
        )}
        {loadError && (
          <div className="bg-red-950/30 border border-red-800/30 rounded-xl px-4 py-3 text-red-400 mb-6">{loadError}</div>
        )}

        {/* Accounts tables */}
        {(tab === "active" || tab === "suspended" || tab === "pending_deletion") && (
          <AccountsTable tab={tab} accounts={accounts} loading={loading} onRestore={(id) => doAction(`/api/admin/accounts/${id}/restore`, "Account restored.")} />
        )}

        {tab === "requests" && (
          <RequestsTable
            requests={requests}
            loading={loading}
            onApprove={(id) => doAction(`/api/admin/deletion-requests/${id}/approve`, "Deletion approved — grace period started.")}
            onCancel={(id) => doAction(`/api/admin/deletion-requests/${id}/cancel`, "Request cancelled.")}
          />
        )}

        {tab === "audit" && <AuditTable logs={logs} loading={loading} />}
      </div>
    </div>
  );
}

function AccountsTable({
  tab,
  accounts,
  loading,
  onRestore,
}: {
  tab: Tab;
  accounts: LifecycleAccount[];
  loading: boolean;
  onRestore: (id: string) => void;
}) {
  if (!loading && accounts.length === 0) {
    return <div className="text-center py-24 text-muted-foreground">No accounts in this category.</div>;
  }
  const showRestore = tab === "suspended" || tab === "pending_deletion";
  return (
    <div className="rounded-2xl border border-border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-card/50">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">User</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Last Active</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">
              {tab === "pending_deletion" ? "Requested" : tab === "suspended" ? "Suspended" : "Joined"}
            </th>
            {showRestore && <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {accounts.map((a, i) => (
            <tr key={a.id} className={`border-b border-border/50 ${i % 2 === 0 ? "bg-background" : "bg-card/20"}`}>
              <td className="px-4 py-3">
                <div className="font-medium text-white">{a.displayName}</div>
                <div className="text-muted-foreground text-xs">{a.email} · @{a.username}</div>
              </td>
              <td className="px-4 py-3"><StatusBadge status={a.accountStatus} /></td>
              <td className="px-4 py-3 text-muted-foreground tabular-nums">{fmt(a.lastActivityAt ?? a.lastLoginAt)}</td>
              <td className="px-4 py-3 text-muted-foreground tabular-nums">
                {fmt(tab === "pending_deletion" ? a.deletionRequestedAt : tab === "suspended" ? a.suspendedAt : a.createdAt)}
              </td>
              {showRestore && (
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" onClick={() => onRestore(a.id)} className="rounded-full border-border gap-1.5 text-green-400 hover:text-green-300">
                    <RotateCcw size={13} /> Restore
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestsTable({
  requests,
  loading,
  onApprove,
  onCancel,
}: {
  requests: DeletionRequest[];
  loading: boolean;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (!loading && requests.length === 0) {
    return <div className="text-center py-24 text-muted-foreground">No deletion requests.</div>;
  }
  return (
    <div className="rounded-2xl border border-border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-card/50">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Email</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Source</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Reason</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Requested</th>
            <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r, i) => (
            <tr key={r.id} className={`border-b border-border/50 ${i % 2 === 0 ? "bg-background" : "bg-card/20"}`}>
              <td className="px-4 py-3">
                <div className="text-white">{r.email}</div>
                {r.username && <div className="text-muted-foreground text-xs">@{r.username}</div>}
                {!r.userId && <div className="text-amber-400/70 text-xs">no linked account</div>}
              </td>
              <td className="px-4 py-3"><span className="uppercase text-xs text-muted-foreground">{r.source}</span></td>
              <td className="px-4 py-3 text-muted-foreground max-w-[240px] truncate" title={r.reason ?? ""}>{r.reason ?? "—"}</td>
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
              <td className="px-4 py-3 text-muted-foreground tabular-nums">{fmt(r.createdAt)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {r.status === "pending" ? (
                  <div className="flex items-center justify-end gap-2">
                    {r.userId && (
                      <Button size="sm" variant="outline" onClick={() => onApprove(r.id)} className="rounded-full border-border gap-1.5 text-red-400 hover:text-red-300">
                        Approve
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => onCancel(r.id)} className="rounded-full gap-1.5 text-muted-foreground hover:text-white">
                      <XCircle size={13} /> Cancel
                    </Button>
                  </div>
                ) : (
                  <span className="text-muted-foreground/50 text-xs">resolved</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ logs, loading }: { logs: AuditLog[]; loading: boolean }) {
  if (!loading && logs.length === 0) {
    return <div className="text-center py-24 text-muted-foreground">No audit log entries.</div>;
  }
  return (
    <div className="rounded-2xl border border-border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-card/50">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Action</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Actor</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">User ID</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">IP</th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">When</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={l.id} className={`border-b border-border/50 ${i % 2 === 0 ? "bg-background" : "bg-card/20"}`}>
              <td className="px-4 py-3 font-mono text-xs text-white">{l.action}</td>
              <td className="px-4 py-3 text-muted-foreground">{l.actorType}</td>
              <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{l.userId ? l.userId.slice(0, 8) : "—"}</td>
              <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{l.ipAddress ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground tabular-nums">{fmt(l.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
