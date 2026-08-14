import { useState } from "react";
import { useLocation } from "wouter";
import { apiUrl } from "@/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!token || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/admin/token-auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const { adminToken } = await res.json() as { adminToken: string };
        sessionStorage.setItem("readyloq_admin_token", adminToken);
        navigate("/dashboard");
      } else {
        const body = await res.json() as { error?: string };
        setError(body.error ?? "Invalid token");
      }
    } catch {
      setError("Connection error — please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-slate-950 px-4">
      <div className="mb-8 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-2">Platform</p>
        <h1 className="text-2xl font-bold text-white">ReadyLoq Admin</h1>
        <p className="text-slate-400 text-sm mt-1">Enter your admin token to continue</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <Input
          type="password"
          placeholder="Admin token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-slate-500 h-11"
          autoFocus
        />
        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
        <Button
          className="w-full h-11 font-semibold"
          disabled={!token || loading}
          onClick={handleSubmit}
        >
          {loading ? <RefreshCw size={16} className="animate-spin mr-2" /> : null}
          Sign in
        </Button>
      </div>
    </div>
  );
}
