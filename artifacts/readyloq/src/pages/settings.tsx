import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, Lightbulb, Layers, Lock } from "lucide-react";
import { useCoaching } from "@/hooks/use-coaching";
import { useCurrentUser, isManagerRole } from "@/hooks/use-current-user";
import { WhiteLabelManager } from "@/components/white-label/white-label-manager";
import { Link } from "wouter";

export default function SettingsPage() {
  const { coachingEnabled, setCoaching } = useCoaching();
  const { data: currentUser, isLoading } = useCurrentUser();
  const isManager = isManagerRole(currentUser?.role);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6" /> Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Personal preferences and organization branding
          </p>
        </div>
        <Link href="/capability">
          <Button variant="outline" size="sm" className="gap-2 text-muted-foreground hover:text-foreground shrink-0">
            <Layers className="h-3.5 w-3.5" />
            Capability Center
          </Button>
        </Link>
      </div>

      {/* Verification suggestions — available to everyone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4" /> Verification Suggestions
          </CardTitle>
          <CardDescription>
            Shows category-specific verification suggestions under each finding. Report confidence and
            verification status are always shown regardless of this setting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${coachingEnabled ? "bg-primary/15" : "bg-muted"}`}>
                <Lightbulb className={`h-4 w-4 ${coachingEnabled ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="text-sm font-medium">{coachingEnabled ? "Suggestions on" : "Suggestions off"}</p>
                <p className="text-xs text-muted-foreground">
                  {coachingEnabled ? "Verification suggestions shown per finding" : "Hands-off — suggestions hidden"}
                </p>
              </div>
            </div>
            <Switch checked={coachingEnabled} onCheckedChange={setCoaching} />
          </div>
        </CardContent>
      </Card>

      {/* White label manager — managers only */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : isManager ? (
        <WhiteLabelManager />
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-8 flex items-center gap-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0" />
            Branding & white-label settings are managed by your organization’s administrators.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
