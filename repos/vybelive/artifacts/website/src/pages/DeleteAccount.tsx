import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTitle } from "@/hooks/use-title";
import { CheckCircle2, ShieldAlert, Trash2 } from "lucide-react";

export default function DeleteAccount() {
  useTitle("Delete Your Account");

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${base}/api/account/web-delete-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim() || undefined,
          reason: reason.trim() || undefined,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError((body as { error?: string }).error ?? "Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="pt-32 pb-24 min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6">
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="text-green-400" size={28} />
            </div>
            <h1 className="text-2xl font-display font-black text-white mb-3">Request received</h1>
            <p className="text-muted-foreground leading-relaxed">
              We've received your account deletion request. Our team will verify ownership and process the
              deletion of your account and associated data. You'll receive a confirmation by email once it's
              complete.
            </p>
            <p className="text-muted-foreground/70 text-sm mt-4">
              If you have the VYBE LIVE app installed, you can also delete your account instantly from{" "}
              <span className="text-white">Settings → Account → Delete Account</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-32 pb-24 min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Trash2 className="text-primary" size={22} />
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-black text-white">Delete Your Account</h1>
        </div>
        <p className="text-muted-foreground leading-relaxed mb-8">
          Use this form to request deletion of your VYBE LIVE account and all associated data. This is the
          same data-deletion process referenced in our{" "}
          <a href={`${base}/privacy`} className="text-primary hover:underline">Privacy Policy</a>.
        </p>

        {/* What gets deleted */}
        <div className="bg-card border border-border rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-bold text-white mb-3">What happens when you delete your account</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><span className="text-primary mt-0.5">•</span> Your profile, streams, clips, analytics, and connected platform credentials are permanently removed.</li>
            <li className="flex gap-2"><span className="text-primary mt-0.5">•</span> Deletion is final after a 30-day grace period. You can cancel any time during that window by signing back in.</li>
            <li className="flex gap-2"><span className="text-primary mt-0.5">•</span> Some records may be retained where required by law (e.g. billing/transaction history) for the minimum legally required period.</li>
          </ul>
        </div>

        {/* Faster in-app path */}
        <div className="bg-amber-950/20 border border-amber-700/30 rounded-2xl p-5 mb-8 flex gap-3">
          <ShieldAlert className="text-amber-400 flex-shrink-0 mt-0.5" size={20} />
          <p className="text-sm text-amber-200/90 leading-relaxed">
            <strong className="text-amber-300">Have the app?</strong> The fastest way to delete your account is
            in the VYBE LIVE app under <span className="text-white">Settings → Account → Delete Account</span>,
            where deletion happens immediately after password confirmation. Use this web form if you no longer
            have access to the app.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 bg-card border border-border rounded-2xl p-6">
          <div className="space-y-1.5">
            <Label htmlFor="del-email">Account email <span className="text-primary">*</span></Label>
            <Input
              id="del-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="bg-background border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="del-username">Username (optional)</Label>
            <Input
              id="del-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username"
              className="bg-background border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="del-reason">Reason (optional)</Label>
            <Textarea
              id="del-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Help us improve — why are you leaving?"
              rows={3}
              className="bg-background border-border resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-bold rounded-full"
          >
            {submitting ? "Submitting..." : "Request Account Deletion"}
          </Button>
          <p className="text-xs text-muted-foreground/70 text-center">
            We'll verify that you own this account before any data is deleted.
          </p>
        </form>
      </div>
    </div>
  );
}
