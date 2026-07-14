// ─────────────────────────────────────────────────────────────────────────────
// ROADMAP CONFIGURATION — single source of truth for all milestone data.
// Update milestones here; changes reflect everywhere on the site automatically.
// targetDate must be an ISO date string (YYYY-MM-DD) to enable stale detection.
// ─────────────────────────────────────────────────────────────────────────────

export type MilestoneStatus = "completed" | "active" | "upcoming";

export interface Milestone {
  id: string;
  phase: number;
  title: string;
  description: string;
  details: string[];
  status: MilestoneStatus;
  completedAt?: string;   // Human-readable e.g. "Q4 2025" — only for completed
  targetDate?: string;    // ISO date "YYYY-MM-DD" — required for active/upcoming (enables stale detection)
}

export const MILESTONES: Milestone[] = [
  {
    id: "foundation",
    phase: 1,
    title: "Business Foundation",
    description: "Company formation, digital presence, and public launch infrastructure — all shipped.",
    details: [
      "LLC formed and registered",
      "Domain registered and configured",
      "Business email and workspace active",
      "Marketing website live",
      "Beta waitlist open for creator signups",
      "Public roadmap and progress center live",
    ],
    status: "completed",
    completedAt: "Q1 2026",
  },
  {
    id: "mobile-app",
    phase: 2,
    title: "Mobile App",
    description: "The core POV creator app — capture, stream, and manage everything from a dark-mode mobile experience.",
    details: [
      "Mobile app built and running on Android",
      "POV streaming pipeline (phone camera + RTMP ingest)",
      "Creator dashboard, analytics, and notifications",
      "Multi-platform output architecture in place",
    ],
    status: "completed",
    completedAt: "Q2 2026",
  },
  {
    id: "ai-clips",
    phase: 3,
    title: "AI Clip System",
    description: "Automatic short-form clip generation that turns livestreams into TikToks, Reels, and Shorts.",
    details: [
      "AI clip system complete",
      "Auto-generated vertical clips from live streams",
      "One-tap publishing with captions",
      "Clip library and creator dashboard integration",
    ],
    status: "completed",
    completedAt: "Q2 2026",
  },
  {
    id: "approvals",
    phase: 4,
    title: "Developer Verification & Distribution",
    description: "Identity verification, distribution accounts, and a working Android build on the Google Play Internal Testing track.",
    details: [
      "Google Play Console identity verification approved",
      "Android app successfully built and installed",
      "Internal Testing track activated on Google Play",
      "Apple Developer Program enrollment — in review",
    ],
    status: "completed",
    completedAt: "Q2 2026",
  },
  {
    id: "live-engine",
    phase: 5,
    title: "Live Streaming Engine",
    description: "The end-to-end POV livestreaming pipeline — proven with real-world YouTube broadcasts.",
    details: [
      "First successful YouTube livestream completed",
      "Agora RTC channel join working",
      "Agora Media Push delivers video to YouTube",
      "Stream disconnect and automatic reconnect verified",
      "Live stream recovery tested successfully",
      "End-to-end livestream workflow validated (~7s YouTube latency)",
    ],
    status: "completed",
    completedAt: "Q2 2026",
  },
  {
    id: "creator-social",
    phase: 6,
    title: "Creator Social & Community",
    description: "The social layer that turns VYBE from a streaming tool into a creator network.",
    details: [
      "Public creator profiles with follower / following system",
      "Creator discovery and networking",
      "Direct messaging with media, reactions, and read receipts",
      "Creator collaboration and co-stream requests",
    ],
    status: "completed",
    completedAt: "Q2 2026",
  },
  {
    id: "recording-capture",
    phase: 7,
    title: "Recording & Hands-Free Capture",
    description: "Cloud recording plus hands-free moment-marking so creators never miss a highlight.",
    details: [
      "Live stream recording with secure cloud archive",
      "Replay and clip-from-recording foundation",
      "Hands-free voice trigger-phrase moment-marking (on-device)",
      "Creator recognition settings (trigger phrases, sensitivity, capture window)",
    ],
    status: "completed",
    completedAt: "Q2 2026",
  },
  {
    id: "internal-beta",
    phase: 8,
    title: "Internal Beta Testing",
    description: "Real-world reliability testing of the full streaming stack now that end-to-end livestreaming works.",
    details: [
      "Internal beta testing officially started",
      "30-minute and 60-minute stream stability tests",
      "Network switching tests (WiFi ↔ cellular and back)",
      "Background app and battery consumption testing",
      "Stream reliability improvements and bitrate display accuracy",
      "Auto-configure YouTube audience settings (\"Not Made For Kids\")",
    ],
    status: "active",
    targetDate: "2026-08-31",
  },
  {
    id: "multi-platform",
    phase: 9,
    title: "Multi-Platform Expansion",
    description: "Bringing simultaneous multistreaming to every major platform alongside production hardening.",
    details: [
      "Facebook Live, Twitch, and Kick integrations",
      "Multi-platform simultaneous streaming",
      "Enhanced reconnect handling",
      "Advanced stream analytics",
      "Production readiness hardening",
    ],
    status: "upcoming",
    targetDate: "2026-10-15",
  },
  {
    id: "creator-launch",
    phase: 10,
    title: "Creator Beta & Public Launch",
    description: "Invite-only creator beta, then full public release across the App Store and Google Play.",
    details: [
      "Invite-only creator beta across phone, GoPro, Meta Glasses, and RTMP",
      "Free, Pro ($29/mo), and Enterprise ($99/mo) plans live",
      "App Store and Google Play public listings",
      "Open registration and creator onboarding program",
    ],
    status: "upcoming",
    targetDate: "2026-12-31",
  },
  {
    id: "advanced-features",
    phase: 11,
    title: "Hardware & Advanced Features",
    description: "Hands-free wearable streaming and next-generation creator tools after public launch.",
    details: [
      "Meta Glasses live streaming",
      "GoPro live integration",
      "On-device hand-gesture moment-marking",
      "AI highlight generation and advanced AI clipping",
      "Multi-camera streaming and guest co-streaming",
      "Creator monetization tools and advanced analytics",
    ],
    status: "upcoming",
    targetDate: "2027-03-31",
  },
];

// ─── Current Status ────────────────────────────────────────────────────────
// Update these when the active stage changes.

export const CURRENT_STAGE = "Internal Beta Testing";

export const CURRENT_FOCUS = [
  "30-minute and 60-minute stream stability tests",
  "Network switching tests (WiFi ↔ cellular and back)",
  "Background app and battery consumption analysis",
  "Stream reliability improvements and bitrate display accuracy",
  "Recording reliability and hands-free voice moment-marking polish",
  "Multi-platform expansion prep (Facebook, Twitch, Kick)",
];

export const NEXT_MILESTONE = "Multi-Platform Expansion";

export const OVERALL_PROGRESS = 78; // percent complete across all phases

// ─── Utilities ────────────────────────────────────────────────────────────

/**
 * Returns true if a milestone's target date has passed but it is not completed.
 * Used to detect stale milestones that need attention.
 */
export function isStaleMilestone(m: Milestone): boolean {
  if (m.status === "completed") return false;
  if (!m.targetDate) return false;
  return new Date(m.targetDate) < new Date();
}

export function getSummary(): string {
  const completed = MILESTONES.filter((m) => m.status === "completed").length;
  const total = MILESTONES.length;
  const active = MILESTONES.filter((m) => m.status === "active");
  const activeNames = active.map((m) => m.title).join(" and ");
  return `VYBE has entered internal beta testing with successful real-world YouTube livestreams. ${completed} of ${total} phases complete. Currently working on: ${activeNames}.`;
}
