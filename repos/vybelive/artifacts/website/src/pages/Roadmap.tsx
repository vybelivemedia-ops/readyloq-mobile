import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Circle, Zap, Users, ArrowRight, Calendar, Target, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/hooks/use-title";

interface Milestone {
  id: string;
  phase: number;
  title: string;
  description: string;
  details: string[];
  status: "completed" | "active" | "upcoming";
  completedAt?: string;
  targetDate?: string;
}

interface RoadmapData {
  milestones: Milestone[];
  betaCount: number;
  currentStage: string;
  currentFocus: string[];
  nextMilestone: string;
  overallProgress: number;
  summary: string;
  lastUpdated: string;
}

function openWaitlist() {
  window.dispatchEvent(new CustomEvent("open-waitlist"));
}

/** Formats an ISO date like "2026-09-30" → "Q3 2026" */
function formatTargetDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q} ${d.getFullYear()}`;
}

function StatusIcon({ status }: { status: Milestone["status"] }) {
  if (status === "completed") {
    return <CheckCircle2 className="text-green-400 flex-shrink-0" size={22} />;
  }
  if (status === "active") {
    return (
      <span className="relative flex-shrink-0 w-[22px] h-[22px] flex items-center justify-center">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-40" />
        <Zap className="relative text-primary" size={18} />
      </span>
    );
  }
  return <Circle className="text-muted-foreground/40 flex-shrink-0" size={22} />;
}

function StatusBadge({ status }: { status: Milestone["status"] }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-950/60 border border-green-800/40 text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Shipped
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 border border-primary/30 text-primary">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary border border-border text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" /> Upcoming
    </span>
  );
}

export default function Roadmap() {
  useTitle("Public Roadmap");

  const [data, setData] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/roadmap`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const milestones = data?.milestones ?? [];
  const completed = milestones.filter((m) => m.status === "completed").length;
  const total = milestones.length || 7;
  const progress = data?.overallProgress ?? 55;

  return (
    <div className="flex flex-col min-h-screen pt-20">

      {/* HERO */}
      <section className="py-20 border-b border-border bg-background relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-900/5 pointer-events-none" />
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/50 border border-primary/30 text-primary text-xs font-semibold mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              UPDATED JUNE 2026
            </span>
            <h1 className="text-5xl md:text-7xl font-display font-black text-white tracking-tighter mb-6">
              Public<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-500">Roadmap</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              VYBE has entered internal beta testing with successful real-world YouTube livestreams. The platform now
              supports live broadcasting, automatic recovery from disconnects, and end-to-end creator streaming workflows.
              Current development is focused on reliability, multi-platform expansion, and production launch readiness.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
              {["Google Play Verified", "Internal Beta Active", "YouTube Live Tested"].map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-950/50 border border-green-700/40 text-green-300 text-sm font-semibold"
                >
                  <CheckCircle2 size={15} className="text-green-400" />
                  {badge}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* RECENTLY COMPLETED */}
      <section className="pt-10 pb-0 bg-card/20">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="bg-card border border-green-800/30 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <CheckCircle2 size={16} className="text-green-400" />
                <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Recently Completed</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-6">
                {[
                  "First YouTube Livestream Completed",
                  "Agora Media Push → YouTube Live",
                  "Auto-Reconnect & Stream Recovery Verified",
                  "Creator Profiles & Follower System",
                  "Direct Messaging & Creator Discovery",
                  "Live Stream Recording & Cloud Archive",
                  "Hands-Free Voice Moment-Marking",
                  "Internal Beta Testing Started",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2.5 text-sm text-green-300/90">
                    <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CURRENT STATUS PANEL */}
      <section className="py-12 border-b border-border bg-card/20">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-card border border-primary/20 rounded-2xl overflow-hidden"
            style={{ boxShadow: "0 0 32px -12px rgba(225,29,72,0.15)" }}
          >
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">Current Status — June 2026</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/50">
              <div className="p-6">
                <p className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wide">Current Stage</p>
                <p className="text-white font-display font-bold text-lg leading-tight">
                  {loading ? "—" : (data?.currentStage ?? "Building Core Platform")}
                </p>
              </div>
              <div className="p-6 md:col-span-2">
                <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wide">Current Focus</p>
                <ul className="space-y-1.5">
                  {(loading ? ["Loading..."] : (data?.currentFocus ?? [])).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ChevronRight size={14} className="text-primary mt-0.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/50 flex items-center gap-3">
              <Target size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-muted-foreground">
                Next major milestone:{" "}
                <span className="text-white font-semibold">
                  {loading ? "—" : (data?.nextMilestone ?? "Creator Beta Testing")}
                </span>
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* STATS */}
      <section className="py-10 border-b border-border bg-card/10">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            {[
              {
                icon: CheckCircle2,
                label: "Phases Complete",
                value: loading ? "—" : `${completed} of ${total}`,
                color: "text-green-400",
              },
              {
                icon: Zap,
                label: "Overall Progress",
                value: `${progress}%`,
                color: "text-primary",
              },
              {
                icon: Users,
                label: "Beta Signups",
                value: loading ? "—" : (data?.betaCount?.toLocaleString() ?? "0"),
                color: "text-purple-400",
              },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0">
                  <stat.icon className={stat.color} size={20} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-display font-bold text-white">{stat.value}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-white">Overall Progress</span>
              <span className="text-sm font-bold text-primary">{progress}% complete</span>
            </div>
            <div className="h-3 bg-secondary rounded-full overflow-hidden border border-border">
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1.4, ease: "easeOut", delay: 0.4 }}
              />
            </div>
            <div className="flex justify-between mt-2">
              {["Foundation", "Infrastructure", "Platform Integrations", "Beta Testing", "Public Launch"].map((label, i) => (
                <span
                  key={label}
                  className="text-xs text-muted-foreground text-center leading-tight"
                  style={{ width: "20%", textAlign: i === 0 ? "left" : i === 4 ? "right" : "center" }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MILESTONE DASHBOARD */}
      <section className="py-10 border-b border-border bg-card/10">
        <div className="max-w-4xl mx-auto px-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-6">Company Milestones Dashboard</p>
          <div className="space-y-4">
            {[
              { label: "Business Foundation", pct: 100 },
              { label: "Mobile App & AI Clips", pct: 100 },
              { label: "Developer Verification & Distribution", pct: 100 },
              { label: "Live Streaming Engine", pct: 100 },
              { label: "Creator Social & Community", pct: 100 },
              { label: "Recording & Hands-Free Capture", pct: 100 },
              { label: "Internal Beta Testing", pct: 45 },
            ].map(({ label, pct }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-white font-medium">{label}</span>
                  <span className={`text-sm font-bold ${pct === 100 ? "text-green-400" : "text-primary"}`}>{pct}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-gradient-to-r from-primary to-purple-500"}`}
                    initial={{ width: 0 }}
                    whileInView={{ width: `${pct}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.2, ease: "easeOut" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MILESTONES TIMELINE */}
      <section className="py-16 bg-background flex-1">
        <div className="max-w-4xl mx-auto px-6">
          <div className="space-y-0">
            {(loading ? Array(7).fill(null) : milestones).map((milestone: Milestone | null, i: number) => {
              if (!milestone) {
                return (
                  <div key={i} className="flex gap-6 pb-12">
                    <div className="flex flex-col items-center">
                      <div className="w-[22px] h-[22px] rounded-full bg-secondary animate-pulse" />
                      {i < 6 && <div className="w-px flex-1 bg-border mt-3" />}
                    </div>
                    <div className="flex-1 pb-2">
                      <div className="h-5 w-48 bg-secondary rounded animate-pulse mb-2" />
                      <div className="h-4 w-full bg-secondary/50 rounded animate-pulse" />
                    </div>
                  </div>
                );
              }

              const isLast = i === milestones.length - 1;
              const lineColor =
                milestone.status === "completed"
                  ? "bg-green-800/40"
                  : milestone.status === "active"
                  ? "bg-primary/30"
                  : "bg-border";

              return (
                <motion.div
                  key={milestone.id}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="flex gap-6"
                >
                  <div className="flex flex-col items-center">
                    <StatusIcon status={milestone.status} />
                    {!isLast && <div className={`w-px flex-1 mt-3 min-h-[40px] ${lineColor}`} />}
                  </div>

                  <div className={`flex-1 ${isLast ? "pb-0" : "pb-10"}`}>
                    <div
                      className="bg-card border rounded-2xl p-6"
                      style={{
                        borderColor: milestone.status === "active" ? "rgba(225,29,72,0.3)" : undefined,
                        boxShadow: milestone.status === "active" ? "0 0 24px -8px rgba(225,29,72,0.2)" : undefined,
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div>
                          <span className="text-xs text-muted-foreground font-medium mb-1 block">Phase {milestone.phase}</span>
                          <h3 className="text-xl font-display font-bold text-white">{milestone.title}</h3>
                        </div>
                        <StatusBadge status={milestone.status} />
                      </div>

                      <p className="text-muted-foreground mb-5 leading-relaxed">{milestone.description}</p>

                      <ul className="space-y-2.5">
                        {milestone.details.map((detail, j) => (
                          <li key={j} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              milestone.status === "completed" ? "bg-green-400" :
                              milestone.status === "active" ? "bg-primary" : "bg-muted-foreground/30"
                            }`} />
                            {detail}
                          </li>
                        ))}
                      </ul>

                      {(milestone.completedAt || milestone.targetDate) && (
                        <div className="mt-5 pt-4 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar size={13} />
                          {milestone.completedAt
                            ? `Shipped ${milestone.completedAt}`
                            : `Target: ${formatTargetDate(milestone.targetDate!)}`}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* WHY VYBE EXISTS */}
      <section className="py-16 bg-card/20 border-t border-border">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-2xl md:text-3xl font-display font-bold text-white mb-4">Why VYBE Exists</h2>
            <p className="text-muted-foreground leading-relaxed text-lg max-w-3xl">
              VYBE LIVE was created to simplify livestreaming for creators. Instead of managing multiple devices,
              multiple apps, and multiple live streams, creators can go live once and reach their audience everywhere.
              Our mission is to make multi-platform livestreaming accessible to content creators, fitness trainers,
              car enthusiasts, performers, businesses, and event organizers.
            </p>
          </motion.div>
        </div>
      </section>

      {/* BUSINESS CREDIBILITY */}
      <section className="py-10 border-t border-border bg-background">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="bg-card border border-border rounded-2xl p-6 md:p-8">
              <h3 className="text-lg font-display font-bold text-white mb-1">VYBE LIVE MEDIA LLC</h3>
              <p className="text-xs text-muted-foreground mb-5">Registered U.S. Limited Liability Company</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  "Registered U.S. Business",
                  "Business Verification Complete",
                  "Secure Website & SSL Active",
                  "Beta Waitlist Open",
                  "Internal Beta Testing Active",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2.5 text-sm text-green-300/90">
                    <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground/50 mt-6 border-t border-border pt-4">
                Business identifiers and verification numbers are kept private. This section is for general credibility reference only.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-card border-t border-border">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Want early access?
            </h2>
            <p className="text-muted-foreground mb-8 text-lg">
              Join the beta waitlist and be among the first creators to go live with VYBE LIVE when Creator Beta Testing opens.
            </p>
            <Button
              size="lg"
              onClick={openWaitlist}
              className="h-14 px-10 rounded-full bg-primary hover:bg-primary/90 text-white font-bold text-lg shadow-[0_0_40px_-10px_rgba(225,29,72,0.5)]"
            >
              Join Beta Waitlist <ArrowRight className="ml-2" size={18} />
            </Button>
            <p className="text-xs text-muted-foreground mt-4">Free to join. No credit card required.</p>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
