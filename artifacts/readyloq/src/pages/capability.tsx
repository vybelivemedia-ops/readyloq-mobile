import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Camera,
  Mic,
  Battery,
  Scan,
  FileText,
  ClipboardList,
  Eye,
  Lightbulb,
  BarChart2,
  Crosshair,
  TrendingUp,
  Bell,
  AlertTriangle,
  Building2,
  Shield,
  BrainCircuit,
  Sparkles,
  Target,
  CheckCircle2,
  Cpu,
  Zap,
  Lock,
  UserCheck,
  Clock,
  Server,
  CheckCircle,
  Key,
  BookOpen,
  GraduationCap,
  Trophy,
  Users,
  Star,
  Phone,
  Globe,
  Download,
  Wand2,
  MapPin,
  Database,
  Microscope,
  Plug,
  PenTool,
  ArrowLeft,
  Activity,
  LucideIcon,
} from "lucide-react";

type FeatureStatus = "live" | "beta" | "planned";

interface Feature {
  name: string;
  description: string;
  status: FeatureStatus;
  icon: LucideIcon;
}

interface FeatureGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: string;
  accentBg: string;
  features: Feature[];
}

const LAST_UPDATED = "June 12, 2026";
const TOTAL_API_ENDPOINTS = 32;
const TOTAL_DB_TABLES = 10;
const TOTAL_USER_ROLES = 2;

const featureGroups: FeatureGroup[] = [
  {
    id: "technician",
    label: "Technician Features",
    icon: Scan,
    accent: "text-sky-400",
    accentBg: "bg-sky-500/10 border-sky-500/20",
    features: [
      {
        name: "Inspection Stops",
        description: "Create, manage, and complete pest control job sites with full media capture.",
        status: "live",
        icon: ClipboardList,
      },
      {
        name: "AI Camera Pipeline",
        description: "Intelligent zoom, macro focus, low-light detection, and stabilization before capture.",
        status: "live",
        icon: Camera,
      },
      {
        name: "Voice Logging",
        description: "Hands-free field logging with full vocabulary in English, Spanish, and Portuguese.",
        status: "live",
        icon: Mic,
      },
      {
        name: "Adaptive Inspection Modes",
        description: "Low Power / Standard / Enhanced modes with auto-downgrade at 20% battery.",
        status: "live",
        icon: Battery,
      },
      {
        name: "Real-Time Pest Detection",
        description: "Live AI frame scanning with animated bounding-box overlay and category classification.",
        status: "beta",
        icon: Scan,
      },
      {
        name: "Report Generation",
        description: "Professional inspection reports with findings, recommendations, and confidence scores.",
        status: "live",
        icon: FileText,
      },
      {
        name: "Evidence Quality Scoring",
        description: "Captures graded Excellent / Good / Fair based on lighting, stability, and confidence.",
        status: "beta",
        icon: BarChart2,
      },
      {
        name: "Verification Suggestions",
        description: "Category-aware field verification prompts shown per finding after analysis.",
        status: "beta",
        icon: Eye,
      },
      {
        name: "Capture Coaching",
        description: "Contextual photo improvement tips for lighting, angle, and distance at capture.",
        status: "beta",
        icon: Lightbulb,
      },
      {
        name: "Dataset Library",
        description: "Historical pest evidence image archive with category and species filtering.",
        status: "live",
        icon: Database,
      },
    ],
  },
  {
    id: "management",
    label: "Management Features",
    icon: Crosshair,
    accent: "text-purple-400",
    accentBg: "bg-purple-500/10 border-purple-500/20",
    features: [
      {
        name: "Command Center",
        description: "Unified opportunity, callback, and property risk intelligence dashboard.",
        status: "live",
        icon: Crosshair,
      },
      {
        name: "Opportunity Intelligence",
        description: "Surfaces findings with unreported service recommendations across all properties.",
        status: "live",
        icon: TrendingUp,
      },
      {
        name: "Callback Management",
        description: "Callback volume trends, frequency analysis, and recurrence tracking.",
        status: "live",
        icon: Bell,
      },
      {
        name: "Property Risk Scoring",
        description: "Aggregates pest pressure and structural risk factors into a per-property score.",
        status: "live",
        icon: AlertTriangle,
      },
      {
        name: "Analytics Dashboard",
        description: "Inspection volume, technician performance metrics, and finding trend charts.",
        status: "live",
        icon: BarChart2,
      },
      {
        name: "White-Label Branding",
        description: "Custom company name, colors, logo URL, tagline, and support contact details.",
        status: "live",
        icon: Building2,
      },
      {
        name: "Management RBAC",
        description: "Command features server-gated to manager role — not just hidden in the UI.",
        status: "live",
        icon: Shield,
      },
    ],
  },
  {
    id: "ai",
    label: "AI Features",
    icon: BrainCircuit,
    accent: "text-violet-400",
    accentBg: "bg-violet-500/10 border-violet-500/20",
    features: [
      {
        name: "Pest Detection Engine",
        description: "Real-time frame analysis with species and category classification during capture.",
        status: "beta",
        icon: BrainCircuit,
      },
      {
        name: "Evidence Quality Grader",
        description: "Multi-signal heuristic: confidence × lighting × stabilization → Excellent / Good / Fair.",
        status: "beta",
        icon: Sparkles,
      },
      {
        name: "Report Confidence Model",
        description: "Three-axis finding quality: AI Confidence + Evidence Quality + Verification Status.",
        status: "beta",
        icon: Target,
      },
      {
        name: "Verification Suggestion Engine",
        description: "Static knowledge base maps 8+ pest categories to actionable field verification checks.",
        status: "live",
        icon: CheckCircle2,
      },
      {
        name: "Terminology Normalizer",
        description: "Maps 50+ casual field expressions to professional pest control report language.",
        status: "live",
        icon: Cpu,
      },
      {
        name: "Risk Aggregation Engine",
        description: "Derives per-property risk scores from cross-inspection finding patterns over time.",
        status: "live",
        icon: Activity,
      },
      {
        name: "Capture Quality Coach",
        description: "Coaching tips generated from capture conditions — gated by user preference setting.",
        status: "beta",
        icon: Zap,
      },
    ],
  },
  {
    id: "security",
    label: "Security Features",
    icon: Lock,
    accent: "text-emerald-400",
    accentBg: "bg-emerald-500/10 border-emerald-500/20",
    features: [
      {
        name: "Clerk Authentication",
        description: "Email + Google OAuth with dark-themed branded sign-in and sign-up flows.",
        status: "live",
        icon: Lock,
      },
      {
        name: "Server-Side RBAC",
        description: "Role enforcement at Express middleware layer — not client-side UI gating only.",
        status: "live",
        icon: Shield,
      },
      {
        name: "JIT User Provisioning",
        description: "User DB record auto-created on first authenticated API request. No manual setup.",
        status: "live",
        icon: UserCheck,
      },
      {
        name: "API Rate Limiting",
        description: "500 requests per 15-minute window per IP address on all /api routes.",
        status: "live",
        icon: Clock,
      },
      {
        name: "Security Headers",
        description: "Helmet middleware: X-Frame-Options, HSTS, XSS protection, content-type sniffing.",
        status: "live",
        icon: Server,
      },
      {
        name: "Zod Input Validation",
        description: "Schema validation on all mutating endpoints — malformed payloads rejected with 400.",
        status: "beta",
        icon: CheckCircle,
      },
      {
        name: "Cookie Session Auth",
        description: "HTTPOnly Clerk session cookies — no localStorage token exposure in the browser.",
        status: "live",
        icon: Key,
      },
    ],
  },
  {
    id: "training",
    label: "Training Features",
    icon: GraduationCap,
    accent: "text-amber-400",
    accentBg: "bg-amber-500/10 border-amber-500/20",
    features: [
      {
        name: "Training Center",
        description: "Structured course library with pest control learning modules by category.",
        status: "live",
        icon: BookOpen,
      },
      {
        name: "Quiz Engine",
        description: "Multiple-choice quizzes with instant grading and correct-answer feedback.",
        status: "live",
        icon: GraduationCap,
      },
      {
        name: "Technician Leaderboard",
        description: "Team score rankings with per-technician category performance breakdown.",
        status: "live",
        icon: Trophy,
      },
      {
        name: "Multi-Category Modules",
        description: "Rodents, cockroaches, termites, carpenter ants, exclusion, and safety tracks.",
        status: "live",
        icon: Users,
      },
      {
        name: "Progress Tracking",
        description: "Individual score history, completion rates, and category-level performance stats.",
        status: "live",
        icon: Star,
      },
    ],
  },
  {
    id: "planned",
    label: "Planned Features",
    icon: Wand2,
    accent: "text-slate-400",
    accentBg: "bg-slate-500/10 border-slate-500/20",
    features: [
      {
        name: "Native Mobile App",
        description: "Expo/React Native app for iOS and Android with offline-first sync.",
        status: "planned",
        icon: Phone,
      },
      {
        name: "Multi-Tenant Architecture",
        description: "Isolated data partitioning per pest control company for enterprise deployment.",
        status: "planned",
        icon: Globe,
      },
      {
        name: "Offline-First Mode",
        description: "Queue inspections without connectivity, auto-sync when reconnected.",
        status: "planned",
        icon: Download,
      },
      {
        name: "AI Report Drafting",
        description: "Auto-generate narrative recommendation paragraphs directly from findings.",
        status: "planned",
        icon: Wand2,
      },
      {
        name: "Route Optimization",
        description: "GPS-aware stop sequencing to minimize drive time across the day's jobs.",
        status: "planned",
        icon: MapPin,
      },
      {
        name: "Push Notifications",
        description: "Callback alerts, overdue inspection reminders, and manager escalations.",
        status: "planned",
        icon: Bell,
      },
      {
        name: "CRM Integration",
        description: "Direct sync with ServiceTitan, FieldRoutes, PestPac, and similar platforms.",
        status: "planned",
        icon: Plug,
      },
      {
        name: "Photo OCR",
        description: "Extract structured data and text from physical service tickets via camera.",
        status: "planned",
        icon: Microscope,
      },
      {
        name: "Probabilistic Pest ID",
        description: "Multi-evidence confidence fusion for high-accuracy species identification (V2 Phase 2).",
        status: "planned",
        icon: BrainCircuit,
      },
      {
        name: "Digital E-Signature",
        description: "Customer sign-off directly on completed inspection reports in the field.",
        status: "planned",
        icon: PenTool,
      },
    ],
  },
];

const statusConfig = {
  live: {
    label: "Live",
    className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20",
  },
  beta: {
    label: "Beta",
    className: "bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20",
  },
  planned: {
    label: "Planned",
    className: "bg-slate-500/15 text-slate-400 border border-slate-500/25 hover:bg-slate-500/20",
  },
};

function StatusBadge({ status }: { status: FeatureStatus }) {
  const cfg = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${cfg.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "live" ? "bg-emerald-400" : status === "beta" ? "bg-amber-400" : "bg-slate-400"}`} />
      {cfg.label}
    </span>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <div className="group flex gap-3 p-3.5 rounded-xl bg-background/60 border border-border/50 hover:border-border/80 hover:bg-background/80 transition-all">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center mt-0.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-tight">{feature.name}</p>
          <StatusBadge status={feature.status} />
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{feature.description}</p>
      </div>
    </div>
  );
}

export default function CapabilityCenter() {
  const allFeatures = featureGroups.flatMap((g) => g.features);
  const liveCount = allFeatures.filter((f) => f.status === "live").length;
  const betaCount = allFeatures.filter((f) => f.status === "beta").length;
  const plannedCount = allFeatures.filter((f) => f.status === "planned").length;
  const totalActive = liveCount + betaCount;

  const stats = [
    { label: "Live Features", value: liveCount, sub: `+ ${betaCount} beta`, color: "text-emerald-400" },
    { label: "API Endpoints", value: TOTAL_API_ENDPOINTS, sub: "REST routes", color: "text-sky-400" },
    { label: "Database Tables", value: TOTAL_DB_TABLES, sub: "PostgreSQL", color: "text-violet-400" },
    { label: "User Roles", value: TOTAL_USER_ROLES, sub: "Technician · Manager", color: "text-amber-400" },
    { label: "On Roadmap", value: plannedCount, sub: "planned features", color: "text-slate-400" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-8">
      {/* Back */}
      <div className="flex items-center gap-3 pt-1">
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground -ml-2 h-8">
            <ArrowLeft className="h-3.5 w-3.5" />
            Settings
          </Button>
        </Link>
      </div>

      {/* Hero Header */}
      <div className="relative rounded-2xl overflow-hidden border border-border/50 bg-card/50">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-violet-500/5 pointer-events-none" />
        <div className="relative p-8 md:p-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/20">
                  <Scan className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">
                    Ready<span className="text-primary">Loq</span>
                    <span className="text-muted-foreground font-normal ml-2 text-xl">Capability Center</span>
                  </h1>
                  <p className="text-xs text-muted-foreground mt-0.5">AI-Powered Pest Control Inspection Platform</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground max-w-lg leading-relaxed">
                A complete overview of every feature implemented, in beta, and planned — organized by user role and platform layer. Use this for demos, stakeholder meetings, and pilot presentations.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <StatusBadge status="live" />
                <span className="text-[11px] text-muted-foreground">Production-ready</span>
                <StatusBadge status="beta" />
                <span className="text-[11px] text-muted-foreground">Functional, being refined</span>
                <StatusBadge status="planned" />
                <span className="text-[11px] text-muted-foreground">On the roadmap</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Last Updated</p>
              <p className="text-sm font-semibold">{LAST_UPDATED}</p>
              <p className="text-[10px] text-muted-foreground mt-3 uppercase tracking-widest mb-1">Total Active</p>
              <p className="text-3xl font-bold text-primary">{totalActive}</p>
              <p className="text-[10px] text-muted-foreground">features deployed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border/50 bg-card/50 p-4 text-center space-y-1"
          >
            <p className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
            <p className="text-xs font-semibold text-foreground">{stat.label}</p>
            <p className="text-[10px] text-muted-foreground">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Feature Groups */}
      {featureGroups.map((group) => {
        const Icon = group.icon;
        const live = group.features.filter((f) => f.status === "live").length;
        const beta = group.features.filter((f) => f.status === "beta").length;
        const planned = group.features.filter((f) => f.status === "planned").length;

        return (
          <div key={group.id} className="space-y-3">
            {/* Section Header */}
            <div className={`flex items-center justify-between rounded-xl px-4 py-3 border ${group.accentBg}`}>
              <div className="flex items-center gap-2.5">
                <Icon className={`h-4.5 w-4.5 ${group.accent}`} />
                <h2 className={`text-sm font-bold ${group.accent}`}>{group.label}</h2>
                <span className="text-[11px] text-muted-foreground ml-1">
                  {group.features.length} feature{group.features.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {live > 0 && <span><span className="text-emerald-400 font-semibold">{live}</span> live</span>}
                {beta > 0 && <span><span className="text-amber-400 font-semibold">{beta}</span> beta</span>}
                {planned > 0 && <span><span className="text-slate-400 font-semibold">{planned}</span> planned</span>}
              </div>
            </div>

            {/* Feature Cards Grid */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {group.features.map((feature) => (
                <FeatureCard key={feature.name} feature={feature} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-foreground">ReadyLoq Field OS</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Built for pest control professionals · {totalActive} active features · {plannedCount} on the roadmap
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          All systems operational · v1.0 Pilot
        </div>
      </div>
    </div>
  );
}
