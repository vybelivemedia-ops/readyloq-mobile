import { useState, useEffect, useMemo, useCallback } from "react";
import { useUser, useClerk } from "@clerk/clerk-react";
import { useLocation } from "wouter";
import { apiUrl } from "@/config";
import {
  LogOut, Users, Building2, CreditCard,
  Search, RefreshCw, ShieldCheck, Zap, KeyRound,
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
  const { isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [, navigate] = useLocation();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapping, setBootstrapping] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [patchingId, setPatchingId] = useState<number | null>(null);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { navigate("/login"); return; }
    void (async () => {
      try {
        const res = await fetch(apiUrl("/me"), { credentials: "include" });
        if (!res.ok) { setNeedsBootstrap(true); return; }
        const me = await res.json() as { isSuperAdmin: boolean };
        if (!me.isSuperAdmin) { setNeedsBootstrap(true); return; }
        setAuthorized(true);
      } catch { setNeedsBootstrap(true); }
    })();
  }, [isLoaded, isSignedIn, navigate]);

  // ── Bootstrap handler ──────────────────────────────────────────────────────
  const handleBootstrap = useCallback(async () => {
    setBootstrapping(true);
    setBootstrapError("");
    try {
      const res = await fetch(apiUrl("/admin/bootstrap"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: bootstrapToken }),
      });
      if (res.ok) {
        setNeedsBootstrap(false);
        setAuthorized(true);
      } else {
        const body = await res.json() as { error?: string };
        setBootstrapError(body.error ?? "Invalid token");
      }
    } catch {
      setBootstrapError("Network error — make sure you're connected");
    } finally {
      setBootstrapping(false);
    }
  }, [bootstrapToken]);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    try {
      const [usersRes, plansRes] = await Promise.all([
        fetch(apiUrl("/admin/users"), { credentials: "include" }),
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
      const res = await fetch(apiUrl(`/admin/users/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!isLoaded || (authorized === null && !needsBootstrap)) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950">
        <RefreshCw className="animate-spin text-slate-500" size={24} />
      </div>
    );
  }

  if (needsBootstrap) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-slate-950 px-4">
        <div className="mb-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <KeyRound size={22} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-white">Claim admin access</h1>
          <p className="text-slate-400 text-sm mt-2 max-w-sm">
            Your account is signed in but not yet elevated. Enter the bootstrap token to grant yourself super-admin access.
          </p>
        </div>
        <div className="w-full max-w-sm space-y-3">
          <Input
            type="password"
            placeholder="Bootstrap token"
            value={bootstrapToken}
            onChange={e => setBootstrapToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !bootstrapping && bootstrapToken && handleBootstrap()}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
          />
          {bootstrapError && (
            <p className="text-red-400 text-sm">{bootstrapError}</p>
          )}
          <Button
            className="w-full"
            disabled={!bootstrapToken || bootstrapping}
            onClick={handleBootstrap}
          >
            {bootstrapping ? <RefreshCw size={16} className="animate-spin mr-2" /> : null}
            Claim access
          </Button>
          <Button
            variant="ghost"
            className="w-full text-slate-500"
            onClick={() => signOut(() => navigate("/login"))}
          >
            Sign out
          </Button>
        </div>
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
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white gap-2"
            onClick={() => signOut(() => navigate("/login"))}
          >
            <LogOut size={14} />
            Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 md:px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total users"    value={users.length}                                     icon={Users}       accent="bg-blue-600" />
          <StatCard label="Companies"      value={companies.length}                                  icon={Building2}   accent="bg-emerald-600" />
          <StatCard label="Super admins"   value={users.filter((u) => u.isSuperAdmin).length}        icon={ShieldCheck} accent="bg-purple-600" />
          <StatCard label="Beta access"    value={users.filter((u) => u.betaAccess).length}          icon={Zap}         accent="bg-amber-600" />
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-800 flex items-center gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === id
                  ? "border-primary text-white"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
          <div className="ml-auto pb-1">
            <Button variant="ghost" size="sm" onClick={loadData} className="text-slate-400 hover:text-white gap-1.5">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Users Tab ──────────────────────────────────────────────────────── */}
        {tab === "users" && (
          <div className="space-y-4">
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                placeholder="Search by name, company, role…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 h-9"
              />
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left">
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">User</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Company</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Role</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-center">Beta</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-center">Admin</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Last seen</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          <RefreshCw className="animate-spin mx-auto" size={20} />
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                          No users found
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-800/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono text-xs text-slate-300" title={u.clerkUserId}>
                                {truncate(u.clerkUserId, 16)}
                              </span>
                              {u.isSuperAdmin && (
                                <span className="text-[10px] text-purple-400 font-medium">⬡ Platform admin</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {u.companyName ?? <span className="text-slate-500 italic">No company</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Select
                              value={u.roleOverride ?? u.role}
                              onValueChange={(val) => patchUser(u.id, { role: val as typeof ROLES[number] })}
                              disabled={patchingId === u.id}
                            >
                              <SelectTrigger className="h-7 w-[120px] bg-slate-800 border-slate-700 text-xs text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-800 border-slate-700">
                                {ROLES.map((r) => (
                                  <SelectItem key={r} value={r} className="text-xs text-slate-200 focus:bg-slate-700 focus:text-white">
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={u.betaAccess}
                              disabled={patchingId === u.id}
                              onChange={(e) => patchUser(u.id, { betaAccess: e.target.checked })}
                              className="w-4 h-4 accent-amber-500 cursor-pointer"
                              title="Beta access"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={u.isSuperAdmin}
                              disabled={patchingId === u.id}
                              onChange={(e) => {
                                if (!window.confirm(`${e.target.checked ? "Grant" : "Revoke"} super admin for this user?`)) return;
                                void patchUser(u.id, { isSuperAdmin: e.target.checked });
                              }}
                              className="w-4 h-4 accent-purple-500 cursor-pointer"
                              title="Super admin"
                            />
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">{fmt(u.lastSeenAt)}</td>
                          <td className="px-4 py-3 text-xs text-slate-400">{fmt(u.createdAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {filteredUsers.length > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-800 text-xs text-slate-500">
                  {filteredUsers.length} of {users.length} users
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Companies Tab ──────────────────────────────────────────────────── */}
        {tab === "companies" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {loading ? (
              <div className="col-span-full flex justify-center py-12">
                <RefreshCw className="animate-spin text-slate-500" size={24} />
              </div>
            ) : companies.length === 0 ? (
              <div className="col-span-full text-center py-12 text-slate-500">No companies yet</div>
            ) : (
              companies.map((co) => (
                <div key={co.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-white">{co.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">ID #{co.id}</p>
                    </div>
                    <Badge variant="outline" className="text-xs border-slate-700 text-slate-400 shrink-0">
                      {co.members.length} {co.members.length === 1 ? "user" : "users"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {co.members.slice(0, 4).map((u) => (
                      <div key={u.id} className="flex items-center justify-between text-xs py-1 border-t border-slate-800">
                        <span className="font-mono text-slate-400" title={u.clerkUserId}>
                          {truncate(u.clerkUserId, 20)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 border-slate-700 text-slate-400">
                            {u.roleOverride ?? u.role}
                          </Badge>
                          {u.betaAccess && <Zap size={10} className="text-amber-400" />}
                          {u.isSuperAdmin && <ShieldCheck size={10} className="text-purple-400" />}
                        </div>
                      </div>
                    ))}
                    {co.members.length > 4 && (
                      <p className="text-xs text-slate-500 pt-1">+{co.members.length - 4} more</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Billing Tab ────────────────────────────────────────────────────── */}
        {tab === "billing" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {loading ? (
              <div className="col-span-full flex justify-center py-12">
                <RefreshCw className="animate-spin text-slate-500" size={24} />
              </div>
            ) : plans.length === 0 ? (
              <div className="col-span-full text-center py-12 text-slate-500">No plans found</div>
            ) : (
              plans.map((plan) => (
                <div key={plan.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div>
                    <p className="font-semibold text-white text-lg">{plan.name}</p>
                    {plan.description && (
                      <p className="text-sm text-slate-400 mt-1">{plan.description}</p>
                    )}
                  </div>
                  {plan.prices.length > 0 && (
                    <div className="space-y-1.5">
                      {plan.prices.map((price) => (
                        <div
                          key={price.id}
                          className="flex items-center justify-between text-sm border border-slate-800 rounded-lg px-3 py-2"
                        >
                          <span className="text-slate-400 text-xs font-mono truncate" title={price.id}>
                            {truncate(price.id, 20)}
                          </span>
                          <span className="text-white font-semibold text-sm">{formatPrice(price)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {Object.keys(plan.metadata).length > 0 && (
                    <div className="space-y-1">
                      {Object.entries(plan.metadata).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">{k}</span>
                          <span className="text-slate-300">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
