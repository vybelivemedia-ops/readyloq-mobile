import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useClerk } from "@clerk/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "@/components/branding-provider";
import { brandLogoSrc } from "@/lib/branding";
import { Building2, Ticket, LogOut } from "lucide-react";

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Request failed";
    throw new Error(message);
  }
  return data;
}

export default function Onboarding() {
  const branding = useBranding();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { signOut } = useClerk();

  const [companyName, setCompanyName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function refreshUser() {
    await queryClient.invalidateQueries({ queryKey: ["currentUser"] });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = companyName.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      await postJson("/api/auth/company", { name });
      toast({ title: "Workspace ready", description: `Welcome to ${name}.` });
      await refreshUser();
    } catch (err) {
      toast({
        title: "Could not create company",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const token = inviteToken.trim();
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      await postJson("/api/auth/accept-invite", { token });
      toast({ title: "Invite accepted", description: "You've joined the team." });
      await refreshUser();
    } catch (err) {
      toast({
        title: "Could not accept invite",
        description: err instanceof Error ? err.message : "Check the token and try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center gap-3">
          <img
            src={brandLogoSrc(branding)}
            alt={branding.companyName}
            className="w-16 h-16 rounded-2xl object-contain"
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Set up your workspace</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Create a company to get started, or join an existing team with an invite.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="create">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="create">
                  <Building2 className="h-4 w-4 mr-2" />
                  Create
                </TabsTrigger>
                <TabsTrigger value="join">
                  <Ticket className="h-4 w-4 mr-2" />
                  Join
                </TabsTrigger>
              </TabsList>

              <TabsContent value="create">
                <form onSubmit={handleCreate} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="company-name">Company name</Label>
                    <Input
                      id="company-name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Acme Pest Control"
                      maxLength={120}
                      autoFocus
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting || !companyName.trim()}>
                    {submitting ? "Creating…" : "Create company"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    You'll become the owner and can invite your team afterwards.
                  </p>
                </form>
              </TabsContent>

              <TabsContent value="join">
                <form onSubmit={handleJoin} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="invite-token">Invite token</Label>
                    <Input
                      id="invite-token"
                      value={inviteToken}
                      onChange={(e) => setInviteToken(e.target.value)}
                      placeholder="Paste your invite token"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting || !inviteToken.trim()}>
                    {submitting ? "Joining…" : "Join team"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Ask a manager for an invite token to join their company.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
