import { motion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  Lock,
  Radio,
} from "lucide-react";
import { useTitle } from "@/hooks/use-title";

type Status = "done" | "pending" | "blocked";

interface ChecklistItem {
  label: string;
  status: Status;
  note?: string;
  href?: string;
}

interface Phase {
  number: number;
  title: string;
  subtitle: string;
  items: ChecklistItem[];
}

const PUBLIC_PREREQS: ChecklistItem[] = [
  {
    label: "Privacy Policy",
    status: "done",
    note: "Live at /privacy — names VYBE LIVE MEDIA LLC.",
    href: "/privacy",
  },
  {
    label: "Terms of Service",
    status: "done",
    note: "Live at /terms — legally binding agreement, names the entity.",
    href: "/terms",
  },
  {
    label: "Contact Page",
    status: "done",
    note: "Live at /contact — email + website listed.",
    href: "/contact",
  },
  {
    label: "Company Information",
    status: "done",
    note: "VYBE LIVE MEDIA LLC shown in footer, Privacy, and Terms.",
  },
  {
    label: "Support Email",
    status: "done",
    note: "info@getvybe.live — published on the Contact page.",
    href: "mailto:info@getvybe.live",
  },
];

const PHASES: Phase[] = [
  {
    number: 1,
    title: "Developer Onboarding",
    subtitle: "Manual setup in the TikTok for Developers portal. Required before any code can be deployed.",
    items: [
      {
        label: "TikTok Developer Account",
        status: "pending",
        note: "Sign up at developers.tiktok.com with a VYBE business email.",
      },
      {
        label: "TikTok Organization Created",
        status: "pending",
        note: 'Use the exact legal name "VYBE LIVE MEDIA LLC" — shown on the consent screen.',
      },
      {
        label: "TikTok App Created",
        status: "pending",
        note: "Set platforms (iOS + Android + Web), redirect URI, Privacy + Terms URLs.",
      },
      {
        label: "OAuth Credentials Received",
        status: "pending",
        note: "Add client_key + client_secret as TIKTOK_CLIENT_ID / TIKTOK_CLIENT_SECRET secrets.",
      },
    ],
  },
  {
    number: 2,
    title: "Login & Profile",
    subtitle: "OAuth v2 Login Kit. Testable in sandbox immediately after credentials are received.",
    items: [
      {
        label: "TikTok Login Implemented",
        status: "pending",
        note: "OAuth v2 + PKCE. Gotcha: TikTok uses HEX SHA-256 for code_challenge, not Base64URL.",
      },
      {
        label: "TikTok Profile Import Implemented",
        status: "pending",
        note: "Fetch open_id, display_name, avatar via user.info.basic / user.info.profile.",
      },
    ],
  },
  {
    number: 3,
    title: "Clip Publishing",
    subtitle: "Content Posting API. Works in sandbox (private posts) before audit unlocks public posting.",
    items: [
      {
        label: "TikTok Clip Publishing Implemented",
        status: "pending",
        note: "PULL_FROM_URL with a signed Object Storage URL, then poll for PUBLISH_COMPLETE.",
      },
      {
        label: "TikTok Audit Submitted",
        status: "pending",
        note: "Submit the video.publish audit after the sandbox flow works end-to-end.",
      },
      {
        label: "TikTok Production Approval Received",
        status: "pending",
        note: "TikTok review typically takes 3–7 days. Unlocks publicly visible posts.",
      },
    ],
  },
  {
    number: 4,
    title: "LIVE Streaming",
    subtitle: "No public LIVE API exists — manual RTMP only, exactly how Restream & StreamYard do it.",
    items: [
      {
        label: "TikTok LIVE RTMP Destination Implemented",
        status: "pending",
        note: "Store user-provided RTMP URL + stream key; push via Agora. No TikTok API call.",
      },
      {
        label: "TikTok Creator Setup Guide Added",
        status: "pending",
        note: "In-app guide: copy RTMP URL + key from TikTok LIVE Studio → PC Streaming.",
      },
    ],
  },
];

function StatusIcon({ status }: { status: Status }) {
  if (status === "done") {
    return <CheckCircle2 className="text-green-400 flex-shrink-0" size={20} />;
  }
  if (status === "blocked") {
    return <AlertTriangle className="text-red-400 flex-shrink-0" size={20} />;
  }
  return <Circle className="text-muted-foreground/40 flex-shrink-0" size={20} />;
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-950/60 border border-green-800/40 text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Done
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-950/40 border border-red-800/40 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Blocked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary border border-border text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" /> Not Started
    </span>
  );
}

function resolveHref(href: string): string {
  if (href.startsWith("mailto:") || /^https?:\/\//.test(href)) return href;
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}${href}`;
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const isMailto = item.href?.startsWith("mailto:") ?? false;
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 border-b border-border/50 last:border-b-0 hover:bg-card/40 transition-colors">
      <div className="mt-0.5">
        <StatusIcon status={item.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{item.label}</span>
          {item.href && (
            <a
              href={resolveHref(item.href)}
              target={isMailto ? undefined : "_blank"}
              rel={isMailto ? undefined : "noopener noreferrer"}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 text-xs"
              aria-label={`Verify ${item.label}`}
            >
              verify <ExternalLink size={11} />
            </a>
          )}
        </div>
        {item.note && (
          <p className="text-sm text-muted-foreground mt-0.5">{item.note}</p>
        )}
      </div>
      <div className="flex-shrink-0">
        <StatusBadge status={item.status} />
      </div>
    </div>
  );
}

export default function TikTokReadiness() {
  useTitle("TikTok Integration Readiness");

  const allPrereqsMet = PUBLIC_PREREQS.every((i) => i.status === "done");
  const prereqsDone = PUBLIC_PREREQS.filter((i) => i.status === "done").length;

  const allItems = PHASES.flatMap((p) => p.items);
  const totalDone =
    PUBLIC_PREREQS.filter((i) => i.status === "done").length +
    allItems.filter((i) => i.status === "done").length;
  const totalItems = PUBLIC_PREREQS.length + allItems.length;
  const progress = Math.round((totalDone / totalItems) * 100);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-6 py-4">
        <h1 className="font-display font-black text-xl text-white">
          VYBE<span className="text-primary">LIVE</span>{" "}
          <span className="text-muted-foreground font-sans font-normal text-base">
            / TikTok Integration Readiness
          </span>
        </h1>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Readiness verdict */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl border px-6 py-5 mb-8 ${
            allPrereqsMet
              ? "bg-green-950/30 border-green-800/40"
              : "bg-amber-950/30 border-amber-700/40"
          }`}
        >
          <div className="flex items-start gap-4">
            <div className="mt-0.5">
              {allPrereqsMet ? (
                <ShieldCheck size={28} className="text-green-400" />
              ) : (
                <AlertTriangle size={28} className="text-amber-400" />
              )}
            </div>
            <div className="flex-1">
              <h2
                className={`text-lg font-bold ${
                  allPrereqsMet ? "text-green-300" : "text-amber-300"
                }`}
              >
                {allPrereqsMet
                  ? "Ready to submit TikTok Developer Account"
                  : "Not ready — public prerequisites missing"}
              </h2>
              <p
                className={`text-sm mt-1 ${
                  allPrereqsMet ? "text-green-400/80" : "text-amber-400/80"
                }`}
              >
                {allPrereqsMet
                  ? `All ${prereqsDone} public prerequisites required for developer account submission are live and accessible. The remaining items below are implementation work that begins after the developer account is approved.`
                  : `${prereqsDone} of ${PUBLIC_PREREQS.length} public prerequisites are met. Resolve the flagged items before submitting.`}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Overall progress */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white">
              Overall progress
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {totalDone} / {totalItems} complete · {progress}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full rounded-full bg-primary"
            />
          </div>
        </div>

        {/* Public prerequisites */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={16} className="text-green-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Public Prerequisites — required to submit
            </h3>
          </div>
          <div className="rounded-2xl border border-border bg-card/20 overflow-hidden">
            {PUBLIC_PREREQS.map((item) => (
              <ChecklistRow key={item.label} item={item} />
            ))}
          </div>
        </section>

        {/* Phases */}
        <div className="space-y-8">
          {PHASES.map((phase) => {
            const phaseDone = phase.items.filter(
              (i) => i.status === "done"
            ).length;
            return (
              <motion.section
                key={phase.number}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="font-display font-black text-2xl text-primary">
                    {String(phase.number).padStart(2, "0")}
                  </span>
                  <h3 className="text-xl font-bold text-white">{phase.title}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums ml-auto flex items-center gap-1">
                    <Clock size={12} />
                    {phaseDone}/{phase.items.length}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mb-3 pl-[2.6rem]">
                  {phase.subtitle}
                </p>
                <div className="rounded-2xl border border-border bg-card/20 overflow-hidden">
                  {phase.items.map((item) => (
                    <ChecklistRow key={item.label} item={item} />
                  ))}
                </div>
              </motion.section>
            );
          })}
        </div>

        {/* Readiness report */}
        <section className="mt-12">
          <div className="flex items-center gap-2 mb-3">
            <Radio size={16} className="text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Readiness Report
            </h3>
          </div>
          <div className="rounded-2xl border border-border bg-card/20 p-6 space-y-5 text-sm">
            <div>
              <p className="font-semibold text-green-300 mb-1">
                ✓ Cleared to submit developer account
              </p>
              <p className="text-muted-foreground">
                All five public requirements TikTok checks during app review —
                Privacy Policy, Terms of Service, Contact Page, Company
                Information, and a Support Email — are live and publicly
                accessible. There are no public-facing blockers to creating the
                TikTok Developer Account and app.
              </p>
            </div>

            <div>
              <p className="font-semibold text-amber-300 mb-1">
                ! Outstanding before code deployment
              </p>
              <ul className="text-muted-foreground space-y-1.5 list-disc pl-5">
                <li>
                  <span className="text-white">OAuth secrets not yet set</span>{" "}
                  — TIKTOK_CLIENT_ID and TIKTOK_CLIENT_SECRET are obtained only
                  after the app is created in the portal, then must be added as
                  Replit secrets.
                </li>
                <li>
                  <span className="text-white">
                    Redirect URI must be registered
                  </span>{" "}
                  — e.g. https://getvybe.live/api/oauth/tiktok/callback, added in
                  the portal before login will work.
                </li>
                <li>
                  <span className="text-white">
                    No physical business address published
                  </span>{" "}
                  — not strictly required, but some org-verification steps
                  request one. Advisory, not a blocker.
                </li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-white mb-1">
                ⚠ Hard platform limitation — LIVE streaming
              </p>
              <p className="text-muted-foreground">
                TikTok has{" "}
                <span className="text-white">no public LIVE streaming API</span>.
                There is no endpoint to programmatically fetch an RTMP URL or
                stream key. Phase 4 is therefore manual RTMP only: creators copy
                their key from TikTok LIVE Studio and paste it into VYBE, which
                pushes via Agora. This matches how Restream and StreamYard
                operate and is not a VYBE-specific constraint.
              </p>
            </div>

            <div>
              <p className="font-semibold text-white mb-1">Recommended order</p>
              <p className="text-muted-foreground">
                Phase 1 (portal setup, 3–14 day review) → Phase 2 (login,
                sandbox) → Phase 3 (clip publishing, sandbox → 3–7 day audit) →
                Phase 4 (manual RTMP, no approval needed). Phases 2 and 4 can
                proceed in parallel since Phase 4 requires no TikTok API access.
              </p>
            </div>
          </div>
        </section>

        <p className="text-xs text-muted-foreground/60 mt-8 text-center">
          Status tracker — update item states as integration work progresses. No
          integration code has been deployed.
        </p>
      </div>
    </div>
  );
}
