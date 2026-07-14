import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Zap, Users, Target } from "lucide-react";

interface RoadmapData {
  betaCount: number;
  currentStage: string;
  currentFocus: string[];
  nextMilestone: string;
  overallProgress: number;
  summary: string;
  milestones: { phase: number; title: string; status: string }[];
}

export function ProgressBanner() {
  const [data, setData] = useState<RoadmapData | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/roadmap`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => null);
  }, []);

  const completed = data?.milestones.filter((m) => m.status === "completed").length ?? 1;
  const total = data?.milestones.length ?? 7;
  const progress = data?.overallProgress ?? 55;
  const betaCount = data?.betaCount ?? null;
  const stage = data?.currentStage ?? "Building Core Platform";
  const focus = data?.currentFocus ?? [
    "Apple Developer Program Organization Approval",
    "Google Play Developer Organization Setup",
    "OAuth Integration (YouTube, Twitch, Facebook, Instagram)",
    "Mobile App Core Development",
    "Creator Beta Recruitment",
  ];

  return (
    <section className="py-20 bg-background border-y border-border">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/50 border border-primary/30 text-primary text-xs font-semibold mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            LIVE PROGRESS
          </span>
          <h2 className="text-3xl md:text-4xl font-display font-bold">Where We Are Today</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            {data?.summary ?? "Active development underway. Business foundation complete, building core platform."}
          </p>
        </motion.div>

        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {[
            {
              icon: CheckCircle2,
              label: "Phases Shipped",
              value: `${completed} of ${total}`,
              color: "text-green-400",
            },
            {
              icon: Zap,
              label: "Current Stage",
              value: stage,
              color: "text-primary",
            },
            {
              icon: Users,
              label: "Beta Signups",
              value: betaCount !== null ? betaCount.toLocaleString() : "—",
              color: "text-purple-400",
            },
          ].map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-card border border-border rounded-2xl p-6 flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                <stat.icon className={stat.color} size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-sm">{stat.label}</p>
                <p className="text-white font-bold text-lg leading-tight truncate">{stat.value}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="bg-card border border-border rounded-2xl p-6 mb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-white">Overall Progress</span>
            <span className="text-sm font-bold text-primary">{progress}%</span>
          </div>
          <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-purple-600 to-fuchsia-500 rounded-full"
              initial={{ width: 0 }}
              whileInView={{ width: `${progress}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-xs text-muted-foreground">Foundation</span>
            <span className="text-xs text-muted-foreground">Public Launch</span>
          </div>
        </div>

        {/* Current focus + next milestone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-card border border-primary/20 rounded-2xl p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">Current Focus</span>
            </div>
            <ul className="space-y-2">
              {focus.map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary/60 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="bg-card border border-border rounded-2xl p-6 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Target size={14} className="text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next Major Milestone</span>
              </div>
              <p className="text-xl font-display font-bold text-white">
                {data?.nextMilestone ?? "Creator Beta Testing"}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Invite-only beta testing with real creators in real-world environments. Collect feedback, validate performance, and prepare for public launch.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("open-waitlist"))}
                className="text-sm text-primary font-semibold hover:text-primary/80 transition-colors"
              >
                Join waitlist to get early access →
              </button>
            </div>
          </motion.div>
        </div>

        <div className="text-center">
          <Link
            href="/roadmap"
            className="inline-flex items-center gap-2 text-primary font-semibold hover:text-primary/80 transition-colors"
          >
            View full roadmap <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}
