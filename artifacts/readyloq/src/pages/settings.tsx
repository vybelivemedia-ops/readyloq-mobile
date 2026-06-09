import { useState, useEffect } from "react";
import { useGetBranding, useUpdateBranding } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Settings, Palette, Building2, Save, BrainCircuit, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetBrandingQueryKey } from "@workspace/api-client-react";

export default function SettingsPage() {
  const { data: branding, isLoading } = useGetBranding();
  const updateBranding = useUpdateBranding();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    companyName: "",
    primaryColor: "#0ea5e9",
    accentColor: "#06b6d4",
    tagline: "",
    supportEmail: "",
    supportPhone: "",
    poweredByVisible: true,
  });

  useEffect(() => {
    if (branding) {
      setForm({
        companyName: branding.companyName,
        primaryColor: branding.primaryColor ?? "#0ea5e9",
        accentColor: branding.accentColor ?? "#06b6d4",
        tagline: branding.tagline ?? "",
        supportEmail: branding.supportEmail ?? "",
        supportPhone: branding.supportPhone ?? "",
        poweredByVisible: branding.poweredByVisible,
      });
    }
  }, [branding]);

  const handleSave = async () => {
    try {
      await updateBranding.mutateAsync({ data: form });
      queryClient.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
      toast({ title: "Settings saved", description: "Branding updated successfully." });
    } catch {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    }
  };

  if (isLoading) return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" /> Settings
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Configure white-label branding for your organization</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Company Identity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Tagline</Label>
                <Input placeholder="Your trusted pest control partner" value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Logo URL</Label>
                <Input placeholder="https://yourcompany.com/logo.png" />
                <p className="text-xs text-muted-foreground">Paste a URL to your company logo</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4" /> Brand Colors
              </CardTitle>
              <CardDescription>Customize colors to match your brand</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div>
                  <Label className="text-xs">Primary Color</Label>
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                      className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
                    />
                    <Input value={form.primaryColor} onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))} className="font-mono text-sm" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Accent Color</Label>
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      type="color"
                      value={form.accentColor}
                      onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                      className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
                    />
                    <Input value={form.accentColor} onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))} className="font-mono text-sm" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Support Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Support Email</Label>
                <Input type="email" placeholder="support@yourcompany.com" value={form.supportEmail} onChange={e => setForm(f => ({ ...f, supportEmail: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Support Phone</Label>
                <Input placeholder="(800) 555-1234" value={form.supportPhone} onChange={e => setForm(f => ({ ...f, supportPhone: e.target.value }))} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Powered by ReadyLoq</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Show ReadyLoq attribution in the app</p>
                </div>
                <Switch checked={form.poweredByVisible} onCheckedChange={v => setForm(f => ({ ...f, poweredByVisible: v }))} />
              </div>
            </CardContent>
          </Card>

          <Button className="w-full" onClick={handleSave} disabled={updateBranding.isPending}>
            {updateBranding.isPending ? "Saving..." : <><Save className="mr-2 h-4 w-4" /> Save Settings</>}
          </Button>
        </div>

        {/* Live Preview */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Live Preview</h3>
          <Card className="overflow-hidden">
            <div className="h-2" style={{ background: form.primaryColor }} />
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${form.primaryColor}20` }}>
                  <BrainCircuit className="h-5 w-5" style={{ color: form.primaryColor }} />
                </div>
                <div>
                  <p className="text-sm font-bold">{form.companyName || "Company Name"}</p>
                  {form.tagline && <p className="text-[10px] text-muted-foreground">{form.tagline}</p>}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                {["Dashboard", "Inspections", "AI Analysis", "Reports"].map(item => (
                  <div key={item} className="flex items-center gap-2 text-sm p-2 rounded-md cursor-pointer"
                    style={item === "Dashboard" ? { background: `${form.primaryColor}15`, color: form.primaryColor } : {}}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: item === "Dashboard" ? form.primaryColor : "hsl(var(--muted-foreground))" }} />
                    <span className={item === "Dashboard" ? "font-medium" : "text-muted-foreground"}>{item}</span>
                  </div>
                ))}
              </div>
              {form.poweredByVisible && (
                <div className="pt-2 border-t border-border text-center">
                  <p className="text-[10px] text-muted-foreground">Powered by ReadyLoq</p>
                </div>
              )}
            </CardContent>
          </Card>

          {(form.supportEmail || form.supportPhone) && (
            <Card>
              <CardContent className="pt-4 text-sm space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Support Contact</p>
                {form.supportEmail && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    <span className="text-muted-foreground">{form.supportEmail}</span>
                  </div>
                )}
                {form.supportPhone && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    <span className="text-muted-foreground">{form.supportPhone}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
