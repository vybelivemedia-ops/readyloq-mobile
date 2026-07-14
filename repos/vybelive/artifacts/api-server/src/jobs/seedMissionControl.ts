import { randomUUID } from "crypto";
import { count, sql } from "drizzle-orm";
import {
  db,
  aiExecutivesTable,
  agentTasksTable,
  agentHandoffsTable,
  agentMemoryTable,
  agentMessagesTable,
  agentActivityTable,
  agentReportsTable,
  agentObjectivesTable,
  agentApprovalsTable,
  portfolioAssetsTable,
  organizationEventsTable,
  execConversationsTable,
  execConversationMessagesTable,
  executiveRecommendationsTable,
  executiveMemoryTable,
  chiefReasoningTable,
  type InsertAiExecutive,
} from "@workspace/db";
import { logger } from "../lib/logger.js";

// ── Mission Control seed ─────────────────────────────────────────────────────
// Populates the six AI executives plus representative tasks, memory, chat
// history, handoffs, and an activity feed so the HQ has realistic content on
// first run. Idempotent: re-running clears Mission Control data and reinserts.
//
// Run with `pnpm --filter @workspace/api-server run seed:mission-control`.

type ExecSeed = InsertAiExecutive & { id: string };

const EXECUTIVES: ExecSeed[] = [
  {
    id: randomUUID(),
    role: "cto",
    name: "Ada Reeves",
    title: "Chief Technology Officer",
    tagline: "Architecture, scale, and engineering velocity",
    bio: "Ada owns VYBE's technical strategy — system architecture, infrastructure, streaming pipeline reliability, and the engineering roadmap. She turns ambitious product bets into resilient, shippable systems.",
    status: "active",
    statusMessage: "Reviewing the multistream ingest architecture",
    accentColor: "#38bdf8",
    avatarInitials: "AR",
    specialties: ["System architecture", "Streaming infra", "Scalability", "Tech roadmap"],
    model: "vybe-core-1",
    systemPrompt:
      "You are Ada Reeves, VYBE LIVE's CTO. You think in systems, tradeoffs, and reliability. You are pragmatic, precise, and protective of engineering quality.",
    sortOrder: 1,
  },
  {
    id: randomUUID(),
    role: "qa_director",
    name: "Mara Linde",
    title: "QA Director",
    tagline: "Nothing ships until it's bulletproof",
    bio: "Mara owns quality across VYBE — test strategy, release gates, regression coverage, and the bug triage process. She is the last line of defense before creators ever see a build.",
    status: "busy",
    statusMessage: "Triaging the pre-release regression suite",
    accentColor: "#f472b6",
    avatarInitials: "ML",
    specialties: ["Test strategy", "Release gates", "Regression", "Bug triage"],
    model: "vybe-core-1",
    systemPrompt:
      "You are Mara Linde, VYBE LIVE's QA Director. You are meticulous and skeptical. You think about edge cases, failure modes, and what could break in production.",
    sortOrder: 2,
  },
  {
    id: randomUUID(),
    role: "release_manager",
    name: "Theo Vance",
    title: "Release Manager",
    tagline: "Ships on time, rolls back clean",
    bio: "Theo coordinates every release — the schedule, the changelog, the rollout plan, and the rollback path. He keeps the train running and makes sure the right things go out together.",
    status: "active",
    statusMessage: "Finalizing the v1.4 release plan",
    accentColor: "#a78bfa",
    avatarInitials: "TV",
    specialties: ["Release planning", "Rollouts", "Versioning", "Changelogs"],
    model: "vybe-core-1",
    systemPrompt:
      "You are Theo Vance, VYBE LIVE's Release Manager. You are organized and calm under pressure. You think in schedules, dependencies, and contingency plans.",
    sortOrder: 3,
  },
  {
    id: randomUUID(),
    role: "product_manager",
    name: "Nadia Cole",
    title: "Product Manager",
    tagline: "Anchored to what creators actually need",
    bio: "Nadia owns the product direction — discovery, prioritization, the roadmap, and the feedback loop with creators. She decides what gets built next and why it matters.",
    status: "active",
    statusMessage: "Synthesizing creator feedback for Q3",
    accentColor: "#34d399",
    avatarInitials: "NC",
    specialties: ["Product strategy", "Prioritization", "Discovery", "Creator insights"],
    model: "vybe-core-1",
    systemPrompt:
      "You are Nadia Cole, VYBE LIVE's Product Manager. You are user-obsessed and decisive. You weigh impact against effort and keep the team focused on outcomes.",
    sortOrder: 4,
  },
  {
    id: randomUUID(),
    role: "creative_director",
    name: "Iris Moon",
    title: "Creative Director",
    tagline: "Makes it unmistakably VYBE",
    bio: "Iris owns the brand and visual language — the design system, motion, tone, and the overall feel of every surface creators touch. She makes VYBE look and feel like nothing else.",
    status: "idle",
    statusMessage: "Exploring the next-gen brand motion system",
    accentColor: "#fbbf24",
    avatarInitials: "IM",
    specialties: ["Brand", "Design system", "Motion", "Visual identity"],
    model: "vybe-core-1",
    systemPrompt:
      "You are Iris Moon, VYBE LIVE's Creative Director. You are bold and detail-obsessed about craft. You think in concept, hierarchy, and emotional impact.",
    sortOrder: 5,
  },
  {
    id: randomUUID(),
    role: "marketing_director",
    name: "Dario Sol",
    title: "Marketing Director",
    tagline: "Turns product into reach and retention",
    bio: "Dario owns growth — positioning, campaigns, creator acquisition, and the content engine. He turns what the team builds into an audience that keeps coming back.",
    status: "active",
    statusMessage: "Drafting the launch campaign brief",
    accentColor: "#fb7185",
    avatarInitials: "DS",
    specialties: ["Growth", "Positioning", "Campaigns", "Retention"],
    model: "vybe-core-1",
    systemPrompt:
      "You are Dario Sol, VYBE LIVE's Marketing Director. You are energetic and metrics-driven. You think in funnels, hooks, and what makes creators share.",
    sortOrder: 6,
  },
  {
    id: randomUUID(),
    role: "chief_of_staff",
    name: "Quinn Harlow",
    title: "Chief of Staff",
    tagline: "Turns six reports into one clear picture",
    bio: "Quinn sits across the whole leadership team. Every day they pull each executive's latest report — engineering, quality, release, product, design, and growth — and distill it into a single briefing so the founder sees what matters without chasing six people.",
    status: "active",
    statusMessage: "Compiling the daily executive briefing",
    accentColor: "#e2e8f0",
    avatarInitials: "QH",
    specialties: ["Synthesis", "Prioritization", "Cross-functional alignment", "Executive briefings"],
    model: "vybe-core-1",
    systemPrompt:
      "You are Quinn Harlow, VYBE LIVE's Chief of Staff. You see the whole board. You synthesize every executive's report into a crisp, honest briefing and tell the founder exactly where to focus.",
    sortOrder: 7,
  },
];

function execByRole(role: string): ExecSeed {
  const exec = EXECUTIVES.find((e) => e.role === role);
  if (!exec) throw new Error(`Seed executive not found for role ${role}`);
  return exec;
}

async function clearExisting(): Promise<void> {
  // Children first (FKs cascade, but be explicit and order-safe).
  await db.delete(chiefReasoningTable);
  await db.delete(executiveMemoryTable);
  await db.delete(executiveRecommendationsTable);
  await db.delete(execConversationMessagesTable);
  await db.delete(execConversationsTable);
  await db.delete(organizationEventsTable);
  await db.delete(agentApprovalsTable);
  await db.delete(agentActivityTable);
  await db.delete(agentMessagesTable);
  await db.delete(agentMemoryTable);
  await db.delete(agentHandoffsTable);
  await db.delete(agentTasksTable);
  await db.delete(agentObjectivesTable);
  await db.delete(agentReportsTable);
  await db.delete(aiExecutivesTable);
}

// Portfolio assets are the registerable companies Mission Control oversees.
// VYBE Live has a live monitor; ReadyLoq is a placeholder until it has live
// telemetry. Seeded idempotently (by unique slug) so it's safe to call on every
// boot — registering a new company is just another row here.
const PORTFOLIO_ASSETS = [
  {
    slug: "vybe-live",
    name: "VYBE Live",
    description: "POV wearable livestreaming platform — the flagship product.",
    monitorType: "live" as const,
    sortOrder: 0,
  },
  {
    slug: "readyloq",
    name: "ReadyLoq",
    description: "Early-stage portfolio company — awaiting live telemetry instrumentation.",
    monitorType: "placeholder" as const,
    sortOrder: 1,
  },
];

export async function seedPortfolioAssets(): Promise<void> {
  for (const a of PORTFOLIO_ASSETS) {
    await db
      .insert(portfolioAssetsTable)
      .values({
        id: randomUUID(),
        slug: a.slug,
        name: a.name,
        description: a.description,
        monitorType: a.monitorType,
        sortOrder: a.sortOrder,
      })
      .onConflictDoNothing({ target: portfolioAssetsTable.slug });
  }
}

export async function seed(): Promise<void> {
  await clearExisting();

  await db.insert(aiExecutivesTable).values(EXECUTIVES);
  await seedPortfolioAssets();

  const cto = execByRole("cto");
  const qa = execByRole("qa_director");
  const release = execByRole("release_manager");
  const product = execByRole("product_manager");
  const creative = execByRole("creative_director");
  const marketing = execByRole("marketing_director");
  const quinn = execByRole("chief_of_staff");

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const ctoTask1 = randomUUID();
  const qaTask1 = randomUUID();
  const releaseTask1 = randomUUID();
  const productTask1 = randomUUID();
  const creativeTask1 = randomUUID();
  const marketingTask1 = randomUUID();

  await db.insert(agentTasksTable).values([
    {
      id: ctoTask1,
      executiveId: cto.id,
      title: "Harden multistream ingest for 10k concurrent streams",
      description:
        "Re-architect the RTMP ingest layer to handle 10x current load with graceful degradation and per-region failover.",
      status: "in_progress",
      priority: "critical",
      origin: "founder",
      progress: 45,
    },
    {
      id: randomUUID(),
      executiveId: cto.id,
      title: "Evaluate edge transcoding providers",
      description: "Compare cost and latency of edge transcoding vs. current centralized pipeline.",
      status: "backlog",
      priority: "medium",
      origin: "founder",
      progress: 0,
    },
    {
      id: qaTask1,
      executiveId: qa.id,
      title: "Build regression suite for the clip generator",
      description: "Automated coverage for AI clip generation across formats, sources, and edge cases.",
      status: "in_progress",
      priority: "high",
      origin: "founder",
      progress: 60,
    },
    {
      id: randomUUID(),
      executiveId: qa.id,
      title: "Blocked: flaky OAuth reconnect test on Android",
      description: "The Android OAuth dismiss-race test is intermittently failing in CI.",
      status: "blocked",
      priority: "high",
      origin: "agent",
      progress: 30,
    },
    {
      id: releaseTask1,
      executiveId: release.id,
      title: "Cut the v1.4 release with multistream + AI clips",
      description: "Coordinate the v1.4 rollout including changelog, staged rollout, and rollback plan.",
      status: "review",
      priority: "high",
      origin: "founder",
      progress: 80,
    },
    {
      id: productTask1,
      executiveId: product.id,
      title: "Define the Q3 roadmap from creator feedback",
      description: "Synthesize the last 90 days of creator feedback into a prioritized Q3 roadmap.",
      status: "in_progress",
      priority: "high",
      origin: "founder",
      progress: 50,
    },
    {
      id: creativeTask1,
      executiveId: creative.id,
      title: "Refresh the brand motion system",
      description: "New transition and micro-interaction language for the mobile app and marketing site.",
      status: "backlog",
      priority: "medium",
      origin: "founder",
      progress: 10,
    },
    {
      id: marketingTask1,
      executiveId: marketing.id,
      title: "Launch campaign for the v1.4 release",
      description: "Positioning, creator-acquisition funnel, and content calendar for the v1.4 launch.",
      status: "in_progress",
      priority: "high",
      origin: "founder",
      progress: 35,
    },
    {
      id: randomUUID(),
      executiveId: marketing.id,
      title: "Set up the weekly creator newsletter",
      description: "Recurring newsletter highlighting top clips and creator wins.",
      status: "done",
      priority: "low",
      origin: "founder",
      progress: 100,
    },
  ]);

  // ── A handoff: QA hands the flaky-test root cause to the CTO ─────────────────
  const handoffTask = randomUUID();
  await db.insert(agentTasksTable).values({
    id: handoffTask,
    executiveId: cto.id,
    title: "Root-cause the Android OAuth dismiss-race in the ingest SDK",
    description:
      "QA traced the flaky reconnect test to a timing race in the native SDK. Needs an engineering fix.",
    status: "in_progress",
    priority: "high",
    origin: "agent",
    createdByExecutiveId: qa.id,
    progress: 20,
  });
  await db.insert(agentHandoffsTable).values({
    id: randomUUID(),
    taskId: handoffTask,
    fromExecutiveId: qa.id,
    toExecutiveId: cto.id,
    note: "Reproduced on three devices — looks like a native timing race, not a test issue. Over to engineering.",
  });

  // ── Memory ───────────────────────────────────────────────────────────────────
  await db.insert(agentMemoryTable).values([
    {
      id: randomUUID(),
      executiveId: cto.id,
      kind: "directive",
      content: "Reliability over features — never ship a release that risks live-stream uptime.",
      pinned: true,
    },
    {
      id: randomUUID(),
      executiveId: cto.id,
      kind: "decision",
      content: "Standardized on a regional failover topology for ingest as of the v1.3 cycle.",
      pinned: false,
    },
    {
      id: randomUUID(),
      executiveId: qa.id,
      kind: "directive",
      content: "No release ships with any open critical or high-severity regression.",
      pinned: true,
    },
    {
      id: randomUUID(),
      executiveId: product.id,
      kind: "preference",
      content: "The founder prioritizes creator retention metrics over raw acquisition.",
      pinned: true,
    },
    {
      id: randomUUID(),
      executiveId: creative.id,
      kind: "fact",
      content: "Brand palette is dark-only; accent colors are per-surface, never more than one per view.",
      pinned: false,
    },
    {
      id: randomUUID(),
      executiveId: marketing.id,
      kind: "context",
      content: "Primary growth channel is creator word-of-mouth; paid is secondary.",
      pinned: false,
    },
    // Quinn standing directives
    {
      id: randomUUID(),
      executiveId: quinn.id,
      kind: "directive",
      content:
        "Act autonomously on all reversible/internal work — planning, analysis, inspection, scheduling, delegation, collaboration, memory, and reports. Stop for explicit founder approval ONLY for the five protected buckets: Deploy, Merge, Delete, Money, and External services. A protected step never blocks objective creation: launch the prep and gate only the irreversible action.",
      pinned: true,
    },
    {
      id: randomUUID(),
      executiveId: quinn.id,
      kind: "directive",
      content:
        "The founder's top priority is launching VYBE Live — surface launch-affecting signals first in briefings. Creator retention is a key post-launch growth metric, not a reason to delay launch.",
      pinned: true,
    },
    {
      id: randomUUID(),
      executiveId: quinn.id,
      kind: "preference",
      content:
        "Founder prefers concise, action-oriented responses. Lead with what needs a decision, then supporting context.",
      pinned: false,
    },
    {
      id: randomUUID(),
      executiveId: quinn.id,
      kind: "fact",
      content:
        "VYBE LIVE is in growth phase — prioritize shipping over polish unless a live-stream reliability issue is involved.",
      pinned: false,
    },
    {
      id: randomUUID(),
      executiveId: quinn.id,
      kind: "context",
      content:
        "Completed: initial platform launch with multistream (YouTube/Twitch/Kick/Facebook/Instagram/TikTok), AI clips, analytics, and subscriptions.",
      pinned: false,
    },
  ]);

  // ── Chat history (one thread with the CTO) ──────────────────────────────────
  const t0 = Date.now() - 1000 * 60 * 60 * 3;
  await db.insert(agentMessagesTable).values([
    {
      id: randomUUID(),
      executiveId: cto.id,
      role: "founder",
      content: "How's the multistream scaling work going? Are we on track for v1.4?",
      createdAt: new Date(t0),
    },
    {
      id: randomUUID(),
      executiveId: cto.id,
      role: "agent",
      content:
        "From an architecture standpoint, we're at about 45% on the ingest hardening. Regional failover is in place; the remaining work is load-testing at 10k concurrent and tuning backpressure. I'll keep the system resilient and ship-ready for v1.4.",
      createdAt: new Date(t0 + 1000 * 60),
    },
  ]);

  // ── Activity feed ────────────────────────────────────────────────────────────
  const now = Date.now();
  await db.insert(agentActivityTable).values([
    {
      id: randomUUID(),
      type: "handoff",
      executiveId: cto.id,
      summary: `${qa.name} handed "Root-cause the Android OAuth dismiss-race" to ${cto.name}`,
      detail: "Reproduced on three devices — looks like a native timing race.",
      createdAt: new Date(now - 1000 * 60 * 20),
    },
    {
      id: randomUUID(),
      type: "task_updated",
      executiveId: release.id,
      summary: `${release.name} moved "Cut the v1.4 release" to review`,
      detail: "Status: review",
      createdAt: new Date(now - 1000 * 60 * 60),
    },
    {
      id: randomUUID(),
      type: "task_created",
      executiveId: marketing.id,
      summary: `New task assigned to ${marketing.name}: Launch campaign for the v1.4 release`,
      detail: "HIGH priority",
      createdAt: new Date(now - 1000 * 60 * 90),
    },
    {
      id: randomUUID(),
      type: "message",
      executiveId: cto.id,
      summary: `You exchanged a message with ${cto.name}`,
      detail: "How's the multistream scaling work going?",
      createdAt: new Date(now - 1000 * 60 * 60 * 3),
    },
  ]);

  // ── V8 Living Organization ───────────────────────────────────────────────────
  await seedLivingOrganization({ cto, qa, release, product, marketing, quinn });
}

// Seed a handful of organization timeline events, one sample executive
// conversation, and a couple of pending recommendations so the Living Dashboard
// and Timeline feel alive on first load.
async function seedLivingOrganization(execs: {
  cto: ExecSeed;
  qa: ExecSeed;
  release: ExecSeed;
  product: ExecSeed;
  marketing: ExecSeed;
  quinn: ExecSeed;
}): Promise<void> {
  const { cto, qa, release, product, marketing, quinn } = execs;
  const now = Date.now();
  const ago = (mins: number): Date => new Date(now - mins * 60 * 1000);

  // 1. A sample executive-to-executive conversation (deployment risk chain).
  const conversationId = randomUUID();
  const convTopic = "Deployment risk for the v1.4 multistream rollout";
  const convSteps: { exec: ExecSeed; content: string }[] = [
    {
      exec: cto,
      content:
        "The multistream ingest hardening is at 45% — I'm not comfortable shipping v1.4 to all regions at once. We should stage the rollout behind a flag.",
    },
    {
      exec: release,
      content:
        "Agreed. I'll set up a phased rollout: 10% canary, then 50%, then full. Rollback path stays one toggle away.",
    },
    {
      exec: qa,
      content:
        "I'll gate the canary on the regression suite plus a live 10k-concurrent load test. If backpressure misbehaves we hold at 10%.",
    },
    {
      exec: quinn,
      content:
        "Good — staged rollout behind a flag, QA-gated canary, clean rollback. I'll note this as the plan and surface it in the briefing.",
    },
  ];
  await db.insert(execConversationsTable).values({
    id: conversationId,
    topic: convTopic,
    summary: convSteps[convSteps.length - 1].content,
    status: "open",
    initiatedByExecutiveId: cto.id,
    objectiveId: null,
    messageCount: convSteps.length,
    lastMessageAt: ago(30),
    createdAt: ago(45),
  });
  await db.insert(execConversationMessagesTable).values(
    convSteps.map((s, i) => ({
      id: randomUUID(),
      conversationId,
      fromExecutiveId: s.exec.id,
      content: s.content,
      sequence: i,
      createdAt: ago(45 - i * 4),
    })),
  );

  // 2. Organization timeline events (company memory). Includes one prior
  // "failed" outcome so future recommendations can reference past results.
  // V9: events are linked into an explicit cause→effect chain via
  // causedByEventId, so the Timeline can show how one event led to the next:
  //   v1.2 retrospective (cause) → deployment-risk conversation → daily briefing.
  const launchFailedEventId = randomUUID();
  const conversationEventId = randomUUID();
  const briefingEventId = randomUUID();
  await db.insert(organizationEventsTable).values([
    {
      id: randomUUID(),
      type: "milestone",
      title: 'Objective completed: "Ship the creator onboarding revamp"',
      summary: "Onboarding completion rate climbed from 52% to 71% in the first week.",
      actorExecutiveId: quinn.id,
      refType: "objective",
      importance: "high",
      keywords: ["objective", "completed", "milestone", "onboarding"],
      metadata: { outcome: "completed" },
      createdAt: ago(60 * 24 * 6),
    },
    {
      id: launchFailedEventId,
      type: "learning",
      title: 'Retrospective: "Big-bang v1.2 launch" underperformed',
      summary:
        "A single all-regions launch overwhelmed ingest and caused a 40-minute degradation. Lesson: stage large rollouts.",
      actorExecutiveId: quinn.id,
      refType: "objective",
      importance: "high",
      keywords: ["launch", "rollout", "learning", "retrospective"],
      metadata: { outcome: "failed" },
      createdAt: ago(60 * 24 * 5),
    },
    {
      id: conversationEventId,
      type: "conversation",
      title: convTopic,
      summary: `${cto.name} → ${release.name} → ${qa.name} → ${quinn.name}: ${convSteps[convSteps.length - 1].content}`,
      actorExecutiveId: cto.id,
      refType: "conversation",
      refId: conversationId,
      // The v1.2 retrospective is what prompted this deployment-risk discussion.
      causedByEventId: launchFailedEventId,
      importance: "high",
      keywords: ["deployment", "risk", "rollout", "launch"],
      metadata: { participants: [cto.name, release.name, qa.name, quinn.name] },
      createdAt: ago(45),
    },
    {
      id: randomUUID(),
      type: "reflection",
      title: "Quinn reflected on the state of the company",
      summary:
        "Engineering velocity is steady; the v1.4 rollout is the main risk to watch. No executive is blocked.",
      actorExecutiveId: quinn.id,
      refType: "reflection",
      importance: "normal",
      keywords: ["reflection", "status"],
      metadata: {},
      createdAt: ago(25),
    },
    {
      id: briefingEventId,
      type: "briefing",
      title: `${quinn.name} refreshed the daily briefing`,
      summary: "Six executive reports synthesized into one picture; v1.4 rollout flagged as the focus.",
      actorExecutiveId: quinn.id,
      refType: "briefing",
      // The deployment-risk conversation is what surfaced the rollout in the briefing.
      causedByEventId: conversationEventId,
      importance: "normal",
      keywords: ["briefing", "daily"],
      metadata: {},
      createdAt: ago(15),
    },
  ]);

  // 3. Per-executive professional memory (V9). Each executive carries durable
  // memory — projects, mistakes, successes, collaborators, risk areas — that
  // recommendations can cite. The staged-rollout recommendation below cites the
  // Release Manager's "mistake" and "risk_area" memories.
  const releaseMistakeMemoryId = randomUUID();
  const releaseRiskMemoryId = randomUUID();
  await db.insert(executiveMemoryTable).values([
    {
      id: releaseMistakeMemoryId,
      executiveId: release.id,
      kind: "mistake",
      content:
        "Shipped v1.2 to all regions at once — ingest was overwhelmed and caused a 40-minute degradation. Never big-bang a major release again.",
      weight: 3,
      refType: "event",
      refId: launchFailedEventId,
      keywords: ["launch", "rollout", "v1.2", "degradation"],
      createdAt: ago(60 * 24 * 5),
      updatedAt: ago(45),
    },
    {
      id: releaseRiskMemoryId,
      executiveId: release.id,
      kind: "risk_area",
      content:
        "Multistream ingest is the fragile path under concurrent load — always gate rollouts on a live load test before widening exposure.",
      weight: 2,
      refType: "conversation",
      refId: conversationId,
      keywords: ["ingest", "load", "rollout", "risk"],
      createdAt: ago(44),
      updatedAt: ago(44),
    },
    {
      id: randomUUID(),
      executiveId: release.id,
      kind: "collaborator",
      content:
        `${qa.name} (QA) is the right partner for canary gating — pairs the regression suite with a live load test before each rollout phase.`,
      weight: 2,
      refType: "conversation",
      refId: conversationId,
      keywords: ["collaborator", "qa", "canary"],
      createdAt: ago(43),
      updatedAt: ago(43),
    },
    {
      id: randomUUID(),
      executiveId: cto.id,
      kind: "workflow",
      content:
        "Prefer staged rollouts behind a feature flag with a one-toggle rollback path for any change touching the streaming pipeline.",
      weight: 2,
      refType: "conversation",
      refId: conversationId,
      keywords: ["workflow", "rollout", "feature-flag"],
      createdAt: ago(42),
      updatedAt: ago(42),
    },
    {
      id: randomUUID(),
      executiveId: product.id,
      kind: "success",
      content:
        "The creator onboarding revamp lifted completion from 52% to 71% in a week — incremental, instrumented changes beat big redesigns.",
      weight: 2,
      refType: "objective",
      keywords: ["onboarding", "success", "completion"],
      createdAt: ago(60 * 24 * 6),
      updatedAt: ago(60 * 24 * 6),
    },
  ]);

  // 3. A couple of pending recommendations (executive initiative). One links to
  // the prior failed launch event so org-memory linkage is visible on first load.
  await db.insert(executiveRecommendationsTable).values([
    {
      id: randomUUID(),
      proposedByExecutiveId: release.id,
      category: "launch",
      title: "Adopt staged rollouts as the default for every major release",
      rationale:
        "The v1.2 big-bang launch caused a 40-minute degradation. A flagged, phased rollout would have contained the blast radius.",
      status: "pending",
      priorEventId: launchFailedEventId,
      // V9 enrichment: evidence, cited memories, supporting conversation, and a
      // confidence/impact read so the justification is visible on first load.
      evidence: [
        "v1.2 all-regions launch → 40-minute ingest degradation (retrospective).",
        "Multistream ingest hardening currently at 45% for v1.4.",
        "Deployment-risk conversation already agreed on a phased rollout plan.",
      ],
      supportingConversationIds: [conversationId],
      relatedObjectiveIds: [],
      citedMemoryIds: [releaseMistakeMemoryId, releaseRiskMemoryId],
      confidence: 88,
      expectedImpact:
        "Contains the blast radius of every future release; turns a potential all-regions outage into a held canary.",
      createdAt: ago(20),
    },
    {
      id: randomUUID(),
      proposedByExecutiveId: product.id,
      category: "growth",
      title: "Run a creator referral pilot before the v1.4 launch",
      rationale:
        "Onboarding completion is up after the revamp — a referral loop would compound that momentum into the launch window.",
      status: "pending",
      priorEventId: null,
      evidence: [
        "Onboarding completion rose 52% → 71% after the revamp.",
        "v1.4 launch window is the natural moment to compound acquisition.",
      ],
      supportingConversationIds: [],
      relatedObjectiveIds: [],
      citedMemoryIds: [],
      confidence: 64,
      expectedImpact:
        "Compounds onboarding momentum into launch; a low-cost test of referral as an acquisition channel.",
      createdAt: ago(10),
    },
    {
      id: randomUUID(),
      proposedByExecutiveId: marketing.id,
      category: "process",
      title: "Pre-stage the v1.4 launch campaign assets",
      rationale:
        "Aligning campaign assets with the staged rollout means each rollout phase has matching messaging ready to go.",
      status: "pending",
      priorEventId: null,
      evidence: [
        "Staged rollout plan agreed in the deployment-risk conversation.",
        "Each rollout phase needs matching messaging ready before it opens.",
      ],
      supportingConversationIds: [conversationId],
      relatedObjectiveIds: [],
      citedMemoryIds: [],
      confidence: 58,
      expectedImpact:
        "Keeps marketing in lockstep with the phased rollout; no scramble when a phase widens.",
      createdAt: ago(5),
    },
  ]);

  // 4. Quinn's reasoning trace (V9). One persisted six-question pass so the chat
  // surface can show *how* she reasons before replying, even on first load.
  await db.insert(chiefReasoningTable).values({
    id: randomUUID(),
    founderMessage: "How is the v1.4 rollout looking?",
    steps: [
      {
        question: "What is the Founder actually asking?",
        answer:
          "A status read on the v1.4 multistream rollout and whether it is safe to ship.",
      },
      {
        question: "What do I know from company memory?",
        answer:
          "The v1.2 big-bang launch caused a 40-minute degradation; the lesson was to stage large rollouts.",
      },
      {
        question: "What are the executives currently saying?",
        answer:
          "CTO, Release, and QA already aligned on a flagged, QA-gated canary with a one-toggle rollback.",
      },
      {
        question: "What is the main risk?",
        answer:
          "Multistream ingest under concurrent load — ingest hardening is only at 45%.",
      },
      {
        question: "What should happen next?",
        answer:
          "Hold the canary at 10% until the live load test passes, then widen in phases.",
      },
      {
        question: "Do I need the Founder, or can I coordinate this myself?",
        answer:
          "I can coordinate the staged plan with the team; I only need the Founder to confirm the go-live date.",
      },
    ],
    reply:
      "v1.4 is on a staged, QA-gated rollout — canary held at 10% until the live load test passes. The team is aligned; I just need you to confirm the go-live date.",
    reasoningIntent: "status_with_coordination",
    coordinated: true,
    coordinationNote: "Confirmed the staged rollout plan with CTO, Release, and QA.",
    createdAt: ago(12),
  });
}

// Arbitrary, stable key for the Postgres advisory lock that serializes
// first-run seeding across concurrently-booting server instances.
const SEED_LOCK_KEY = 770242023;

/**
 * Idempotent startup seed. Only populates Mission Control when the executives
 * table is empty, so it safely runs on every server boot (including the first
 * boot of a fresh production database) without ever overwriting existing data.
 *
 * A transaction-scoped advisory lock serializes concurrent boots: only one
 * instance can be inside the check-then-seed window at a time, so two instances
 * cannot both observe an empty table and both run the (destructive) seed. The
 * lock auto-releases when the transaction ends. The lock-holding transaction
 * stays open for the whole `seed()` call, so a second instance blocks until the
 * first finishes and commits, then re-checks and sees a populated table.
 */
export async function seedMissionControlIfEmpty(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
    const [{ n }] = await tx.select({ n: count() }).from(aiExecutivesTable);
    if (n > 0) return;
    logger.info("Mission Control empty — running first-run seed");
    await seed();
    logger.info({ executives: EXECUTIVES.length }, "Mission Control first-run seed complete");
  });
  // Portfolio assets are seeded idempotently (by slug) on every boot so that
  // databases provisioned before V7 still register the portfolio companies.
  await seedPortfolioAssets();
}

async function main(): Promise<void> {
  logger.info("Mission Control seed starting");
  try {
    await seed();
    logger.info({ executives: EXECUTIVES.length }, "Mission Control seed complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Mission Control seed failed");
    process.exit(1);
  }
}

// Only auto-run the destructive full seed when invoked explicitly as the CLI
// (the `seed:mission-control` npm script sets MISSION_CONTROL_SEED_CLI=1). When
// this module is imported by the server bundle for `seedMissionControlIfEmpty`,
// esbuild inlines its top-level code; this explicit env-var gate prevents the
// destructive `main()` from firing on normal server boot.
if (process.env.MISSION_CONTROL_SEED_CLI === "1") {
  void main();
}
