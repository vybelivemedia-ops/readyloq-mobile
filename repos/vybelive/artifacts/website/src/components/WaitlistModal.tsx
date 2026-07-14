import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";

const CREATOR_TYPES = [
  { value: "content_creator", label: "Content Creator" },
  { value: "car_enthusiast", label: "Car Enthusiast" },
  { value: "fitness_trainer", label: "Fitness Trainer" },
  { value: "performer", label: "Performer" },
  { value: "business", label: "Business" },
  { value: "event_organizer", label: "Event Organizer" },
  { value: "other", label: "Other" },
];

interface WaitlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WaitlistModal({ open, onOpenChange }: WaitlistModalProps) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", creatorType: "" });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.creatorType) return;

    setSubmitting(true);
    setError(null);

    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const res = await fetch(`${base}/api/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (res.status === 409) {
        setError("This email is already on the waitlist.");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Something went wrong. Please try again.");
        return;
      }

      setSuccess(true);
      setForm({ firstName: "", lastName: "", email: "", creatorType: "" });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose(v: boolean) {
    onOpenChange(v);
    if (!v) {
      setTimeout(() => {
        setSuccess(false);
        setError(null);
      }, 300);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        {success ? (
          <div className="flex flex-col items-center text-center py-6 gap-4">
            <CheckCircle2 className="text-primary" size={52} strokeWidth={1.5} />
            <DialogHeader>
              <DialogTitle className="text-2xl font-display font-bold">You're on the list!</DialogTitle>
              <DialogDescription className="text-muted-foreground text-base mt-2">
                We'll notify you when VYBE LIVE beta access becomes available.
              </DialogDescription>
            </DialogHeader>
            <Button className="mt-4 bg-primary hover:bg-primary/90 text-white rounded-full px-8 font-bold" onClick={() => handleClose(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-display font-bold">Join the Beta Waitlist</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Be among the first to get access to VYBE LIVE.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wl-first">First Name</Label>
                  <Input
                    id="wl-first"
                    placeholder="Jane"
                    required
                    value={form.firstName}
                    onChange={(e) => handleChange("firstName", e.target.value)}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wl-last">Last Name</Label>
                  <Input
                    id="wl-last"
                    placeholder="Smith"
                    required
                    value={form.lastName}
                    onChange={(e) => handleChange("lastName", e.target.value)}
                    className="bg-background border-border"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wl-email">Email Address</Label>
                <Input
                  id="wl-email"
                  type="email"
                  placeholder="jane@example.com"
                  required
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  className="bg-background border-border"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wl-type">Creator Type</Label>
                <Select value={form.creatorType} onValueChange={(v) => handleChange("creatorType", v)} required>
                  <SelectTrigger id="wl-type" className="bg-background border-border">
                    <SelectValue placeholder="Select your creator type" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {CREATOR_TYPES.map((ct) => (
                      <SelectItem key={ct.value} value={ct.value}>
                        {ct.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={submitting || !form.creatorType}
                className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 text-white font-bold text-base"
              >
                {submitting ? "Joining..." : "Join Beta Waitlist"}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                We'll only contact you about VYBE LIVE beta access. No spam.
              </p>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
