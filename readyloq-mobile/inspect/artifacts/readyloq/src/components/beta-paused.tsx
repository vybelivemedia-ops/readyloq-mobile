import { useState } from "react";
import { PauseCircle, MessageSquarePlus, LogOut } from "lucide-react";
import { useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/components/branding-provider";
import { brandLogoSrc } from "@/lib/branding";
import { FeedbackDialog } from "@/components/feedback-dialog";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Shown to a technician whose beta access has been paused by a manager. The
 * server independently blocks tenant data routes with { code: "beta_access_disabled" },
 * so this is the friendly client-side mirror of that gate. Feedback submission
 * stays available so a paused tester can still reach their team.
 */
export function BetaPaused() {
  const branding = useBranding();
  const { signOut } = useClerk();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-background gap-7 px-6 text-center">
      <img
        src={brandLogoSrc(branding)}
        alt={branding.companyName}
        className="w-16 h-16 rounded-2xl object-contain"
      />
      <div className="flex flex-col items-center gap-3 max-w-sm">
        <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center">
          <PauseCircle className="h-6 w-6 text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Beta access paused</h1>
        <p className="text-sm text-muted-foreground">
          Your access to {branding.companyName} is paused for now. A manager on your
          team can restore it from the Beta Center. You can still send feedback below.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <Button onClick={() => setFeedbackOpen(true)} className="gap-2">
          <MessageSquarePlus className="h-4 w-4" />
          Send feedback
        </Button>
        <Button
          variant="ghost"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="gap-2 text-muted-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
