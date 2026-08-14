import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { apiUrl } from "@/config";
import {
  LogOut, Users, Building2, CreditCard,
  Search, RefreshCw, ShieldCheck, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number;
  clerkUserId: string;
  role: string;
  roleOverride: string | null;
  isSuperAdmin: boolean;
  betaAccess: boolean;
  companyId: number | null;
  companyName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

interface Price {
  id: string;
  unit_amount: number;
  currency: string;
  recurring: { interval?: string; interval_count?: number } | null;
  metadata: Record<string, string>;
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, string>;
  prices: Price[];
}

type Tab = "users" | "companies" | "billing";

const ROLES = ["owner", "manager", "sales", "technician"] as const;

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function truncate(s: string, n = 12) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function formatPrice(p: Price) {
  const amt = (p.unit_amount / 100).toLocaleString("en-US", { style: "currency", currency: p.currency.toUpperCase() });
  const interval = p.recurring?.interval ?? "";
  return interval ? `${amt}/${interval}` : amt;
}

// ── Admin fetch ───────────────────────────────────────────────────────────────

function getAdminToken(): string | null {
  return sessionStorage.getItem("readyloq_admin_token");
}

function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAdminToken();
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent }: {
  label: string; value: number | string; icon: React.ElementType; accent: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, navigate] = useLocation();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [patchingId, setPatchingId] = useState<number | null>(null);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      navigate("/login");
      return;
    }
    // Verify the token is still accepted by the server
    void adminFetch(apiUrl("/admin/users")).then((res) => {
      if (res.ok) {
        setAuthorized(true);
      } else {
        sessionStorage.removeItem("readyloq_admin_token");
        navigate("/login");
      }
    }).catch(() => {
      navigate("/login");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    try {
      const [usersRes, plansRes] = await Promise.all([
        adminFetch(apiUrl("/admin/users")),
        fetch(apiUrl("/billing/plans")),
      ]);
      if (usersRes.ok) setUsers(await usersRes.json() as AdminUser[]);
      if (plansRes.ok) setPlans(await plansRes.json() as Plan[]);
    } finally {
      setLoading(false);
    }
  }, [authorized]);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const companies = useMemo(() => {
    const map = new Map<number, { id: number; name: string; members: AdminUser[] }>();
    for (const u of users) {
      if (u.companyId === null) continue;
      if (!map.has(u.companyId)) {
        map.set(u.companyId, { id: u.companyId, name: u.companyName ?? `Company #${u.companyId}`, members: [] });
      }
      map.get(u.companyId)!.members.push(u);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.companyName ?? "").toLowerCase().includes(q) ||
        u.clerkUserId.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
  }, [users, search]);

  // ── Patch user ─────────────────────────────────────────────────────────────
  async function patchUser(id: number, updates: Partial<Pick<AdminUser, "role" | "isSuperAdmin" | "betaAccess">>) {
    setPatchingId(id);
    try {
      const res = await adminFetch(apiUrl(`/admin/users/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json() as AdminUser;
        setUsers((prev) => prev.map((u) => u.id === id ? { ...u, ...updated } : u));
      }
    } finally {
      setPatchingId(null);
    }
  }

  // ── Sign out ───────────────────────────────────────────────────────────────
  function signOut() {
    sessionStorage.removeItem("readyloq_admin_token");
    navigate("/login");
  }

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (authorized === null) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950">
        <RefreshCw className="animate-spin text-slate-500" size={24} />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "users",     label: "Users",     icon: Users },
    { id: "companies", label: "Companies", icon: Building2 },
    { id: "billing",   label: "Billing",   icon: CreditCard },
  ];

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">⬡</span>
            <span className="font-bold text-white">ReadyLoq Admin</span>
            <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400">
              Super Admin
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadData()}
              disabled={loading}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-slate-400 hover:text-white gap-1.5"
            >
              <LogOut size={14} />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="max-w-7xl mx-auto w-full px-4 md:px-6 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total users"     value={users.length}     icon={Users}      accent="bg-blue-600" />
          <StatCard label="Companies"       value={companies.length} icon={Building2}  accent="bg-violet-600" />
          <StatCard label="Super admins"    value={users.filter(u => u.isSuperAdmin).length} icon={ShieldCheck} accent="bg-amber-600" />
          <StatCard label="Beta users"      value={users.filter(u => u.betaAccess !== false).length} icon={Zap} accent="bg-emerald-600" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === id
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        {(tab === "users" || tab === "companies") && (
          <div className="relative mb-4 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 h-9 text-sm"
            />
          </div>
        )}

        {/* ── Users tab ── */}
        {tab === "users" && (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60">
                  {["ID", "Clerk ID", "Company", "Role", "Super Admin", "Beta", "Last seen", "Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-900/40 transition-colors">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{u.id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{truncate(u.clerkUserId, 14)}</td>
                    <td className="px-4 py-3 text-slate-300">{u.companyName ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3">
                      <Select
                        value={u.roleOverride ?? u.role}
                        onValueChange={(v) => void patchUser(u.id, { role: v as AdminUser["role"] })}
                        disabled={patchingId === u.id}
                      >
                        <SelectTrigger className="h-7 text-xs w-32 bg-slate-800 border-slate-700">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void patchUser(u.id, { isSuperAdmin: !u.isSuperAdmin })}
                        disabled={patchingId === u.id}
                        className={`w-8 h-5 rounded-full transition-colors ${u.isSuperAdmin ? "bg-amber-500" : "bg-slate-700"}`}
                      >
                        <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${u.isSuperAdmin ? "translate-x-3" : ""}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void patchUser(u.id, { betaAccess: !u.betaAccess })}
                        disabled={patchingId === u.id}
                        className={`w-8 h-5 rounded-full transition-colors ${u.betaAccess !== false ? "bg-emerald-500" : "bg-slate-700"}`}
                      >
                        <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${u.betaAccess !== false ? "translate-x-3" : ""}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmt(u.lastSeenAt)}</td>
                    <td className="px-4 py-3">
                      {patchingId === u.id && <RefreshCw size={12} className="animate-spin text-slate-500" />}
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Companies tab ── */}
        {tab === "companies" && (
          <div className="space-y-3">
            {companies
              .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
              .map((c) => (
                <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold text-white">{c.name}</p>
                      <p className="text-xs text-slate-500">ID {c.id} · {c.members.length} member{c.members.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.members.map((m) => (
                      <Badge key={m.id} variant="outline" className="text-[10px] border-slate-700 text-slate-300 font-mono">
                        {m.roleOverride ?? m.role} · {truncate(m.clerkUserId, 10)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            {companies.length === 0 && (
              <p className="text-slate-500 text-sm py-8 text-center">No companies yet</p>
            )}
          </div>
        )}

        {/* ── Billing tab ── */}
        {tab === "billing" && (
          <div className="space-y-4">
            {plans.map((plan) => (
              <div key={plan.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-white">{plan.name}</p>
                    {plan.description && <p className="text-sm text-slate-400 mt-0.5">{plan.description}</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400 font-mono">{truncate(plan.id, 16)}</Badge>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {plan.prices.map((p) => (
                    <div key={p.id} className="bg-slate-800 rounded-lg px-3 py-1.5 text-sm">
                      <span className="font-medium text-white">{formatPrice(p)}</span>
                      {p.metadata["label"] && <span className="text-slate-400 ml-1.5 text-xs">{p.metadata["label"]}</span>}
                    </div>
                  ))}
                  {plan.prices.length === 0 && <span className="text-slate-500 text-sm">No prices</span>}
                </div>
              </div>
            ))}
            {plans.length === 0 && (
              <p className="text-slate-500 text-sm py-8 text-center">No plans found</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
