import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTitle } from "@/hooks/use-title";
import { format } from "date-fns";
import { AlertTriangle, RefreshCw } from "lucide-react";

const CREATOR_TYPE_LABELS: Record<string, string> = {
  content_creator: "Content Creator",
  car_enthusiast: "Car Enthusiast",
  fitness_trainer: "Fitness Trainer",
  performer: "Performer",
  business: "Business",
  event_organizer: "Event Organizer",
  other: "Other",
};

interface WaitlistEntry {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  creatorType: string;
  createdAt: string;
}

interface StaleMilestone {
  id: string;
  phase: number;
  title: string;
  targetDate: string;
  status: string;
}

export default function AdminWaitlist() {
  useTitle("Admin — Waitlist");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [staleMilestones, setStaleMilestones] = useState<StaleMilestone[]>([]);

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

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
      await Promise.all([loadWaitlist(jwt), loadRoadmapStatus(jwt)]);
    } catch {
      setLoginError("Network error.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function loadWaitlist(jwt: string) {
    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch(`${base}/api/admin/waitlist?limit=200`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      const body = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setLoadError("Access denied — admin role required.");
        } else {
          setLoadError((body as { error?: string }).error ?? "Failed to load waitlist.");
        }
        setToken(null);
        return;
      }

      const data = body as { entries: WaitlistEntry[]; total: number };
      setEntries(data.entries);
      setTotal(data.total);
    } catch {
      setLoadError("Network error loading waitlist.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRoadmapStatus(jwt: string) {
    try {
      const res = await fetch(`${base}/api/admin/roadmap`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) return;
      const data = await res.json() as { staleDetails?: StaleMilestone[] };
      setStaleMilestones(data.staleDetails ?? []);
    } catch {
      // non-critical — ignore
    }
  }

  function handleRefresh() {
    if (token) {
      loadWaitlist(token);
      loadRoadmapStatus(token);
    }
  }

  function handleLogout() {
    setToken(null);
    setEntries([]);
    setTotal(0);
    setStaleMilestones([]);
    setEmail("");
    setPassword("");
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="font-display font-black text-2xl text-white">VYBE<span className="text-primary">LIVE</span></h1>
            <p className="text-muted-foreground mt-2 text-sm">Admin — Waitlist</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 bg-card border border-border rounded-2xl p-6">
            <div className="space-y-1.5">
              <Label htmlFor="adm-email">Admin Email</Label>
              <Input
                id="adm-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="bg-background border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adm-pass">Password</Label>
              <Input
                id="adm-pass"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-background border-border"
              />
            </div>
            {loginError && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
                {loginError}
              </p>
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
        <div>
          <h1 className="font-display font-black text-xl text-white">VYBE<span className="text-primary">LIVE</span> <span className="text-muted-foreground font-sans font-normal text-base">/ Admin / Waitlist</span></h1>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading} className="rounded-full border-border gap-2">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Refresh"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="rounded-full text-muted-foreground">
            Sign Out
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Stale roadmap warning */}
        {staleMilestones.length > 0 && (
          <div className="mb-6 bg-amber-950/30 border border-amber-700/40 rounded-xl px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 font-semibold text-sm mb-1">
                  Roadmap Warning — {staleMilestones.length} milestone{staleMilestones.length > 1 ? "s" : ""} past target date
                </p>
                <p className="text-amber-400/70 text-xs mb-2">
                  These milestones have passed their target date and are hidden from the public roadmap. Update <code className="bg-amber-900/40 px-1 rounded">artifacts/api-server/src/config/roadmap.ts</code> to fix them.
                </p>
                <ul className="space-y-1">
                  {staleMilestones.map((m) => (
                    <li key={m.id} className="text-xs text-amber-400/80 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      Phase {m.phase}: <strong className="text-amber-300">{m.title}</strong>
                      <span className="text-amber-500/60">— target was {m.targetDate}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Beta Waitlist</h2>
            <p className="text-muted-foreground mt-1">{total} total signup{total !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {loadError && (
          <div className="bg-red-950/30 border border-red-800/30 rounded-xl px-4 py-3 text-red-400 mb-6">
            {loadError}
          </div>
        )}

        {entries.length === 0 && !loading && !loadError && (
          <div className="text-center py-24 text-muted-foreground">
            No signups yet.
          </div>
        )}

        {entries.length > 0 && (
          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-card/50">
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Email</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Creator Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Signup Date</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr key={entry.id} className={`border-b border-border/50 ${i % 2 === 0 ? "bg-background" : "bg-card/20"} hover:bg-card/50 transition-colors`}>
                      <td className="px-4 py-3 font-medium text-white">
                        {entry.firstName} {entry.lastName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{entry.email}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-secondary border border-border text-white">
                          {CREATOR_TYPE_LABELS[entry.creatorType] ?? entry.creatorType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {format(new Date(entry.createdAt), "MMM d, yyyy · h:mm a")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
