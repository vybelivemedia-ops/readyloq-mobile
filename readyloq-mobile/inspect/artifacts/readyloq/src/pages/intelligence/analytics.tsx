import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetIntelligenceAnalytics, 
  useGetIntelligenceSettings, 
  useUpdateIntelligenceSettings,
  getGetIntelligenceSettingsQueryKey
} from "@workspace/api-client-react";
import { useCurrentUser, isManagerRole } from "@/hooks/use-current-user";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area 
} from "recharts";
import { Brain, CheckCircle, Database, ShieldAlert, Sparkles } from "lucide-react";

export default function IntelligenceAnalytics() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const isManager = isManagerRole(currentUser?.role);

  const { data: analytics, isLoading } = useGetIntelligenceAnalytics();
  const { data: settings } = useGetIntelligenceSettings({ query: { enabled: isManager, queryKey: getGetIntelligenceSettingsQueryKey() } });
  const updateSettings = useUpdateIntelligenceSettings();
  const queryClient = useQueryClient();

  const handleSharingToggle = async (enabled: boolean) => {
    try {
      await updateSettings.mutateAsync({ data: { sharingEnabled: enabled } });
      queryClient.invalidateQueries({ queryKey: getGetIntelligenceSettingsQueryKey() });
      toast({ title: "Settings updated", description: enabled ? "Cross-company training enabled" : "Cross-company training disabled" });
    } catch (e) {
      toast({ title: "Failed to update settings", variant: "destructive" });
    }
  };

  if (isLoading || !analytics) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const growthData = analytics.datasetGrowth.map(d => ({
    date: d.date.split("T")[0],
    Total: d.total,
    Approved: d.approved
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Intelligence Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitor dataset growth and AI performance
          </p>
        </div>
        {isManager && settings && (
          <Card className="bg-primary/5 border-primary/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Cross-Company Training</Label>
                <p className="text-xs text-muted-foreground">Contribute anonymized data to improve global AI models</p>
              </div>
              <Switch 
                checked={settings.sharingEnabled} 
                onCheckedChange={handleSharingToggle} 
              />
            </div>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">AI vs Tech Agreement</p>
              <Brain className="h-4 w-4 text-primary" />
            </div>
            <p className="text-3xl font-bold">{analytics.aiVsTechnicianAgreementRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Records</p>
              <Database className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-3xl font-bold">{analytics.totalRecords}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Approved for Training</p>
              <Sparkles className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-3xl font-bold">{analytics.approvedForTraining}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Pending Review</p>
              <ShieldAlert className="h-4 w-4 text-orange-500" />
            </div>
            <p className="text-3xl font-bold">{analytics.pendingReview}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Dataset Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growthData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Area type="monotone" dataKey="Total" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="Approved" stackId="2" stroke="#10b981" fill="#10b981" fillOpacity={0.4} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.mostVerifiedCategories.slice(0, 5)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Needed imported icon
import { Activity } from "lucide-react";
