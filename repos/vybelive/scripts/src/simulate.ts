/**
 * VYBE LIVE — 1000-User Platform Simulation
 *
 * Seeds the database with 1000 simulated creators using every POV tool
 * across all platforms simultaneously. Measures and reports key metrics.
 */

import bcrypt from "bcryptjs";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  streamsTable,
  platformsTable,
  clipsTable,
  notificationsTable,
  subscriptionsTable,
  subscriptionPlansTable,
} from "@workspace/db";
import { eq, sql, count, sum, avg, max } from "drizzle-orm";

// ─── Config ───────────────────────────────────────────────────────────────────

const TOTAL_USERS = 1000;
const BATCH_SIZE = 50;
const SIM_START = Date.now();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3_600_000);
}

function log(msg: string) {
  process.stdout.write(`  ${msg}\n`);
}

function bar(label: string, val: number, total: number, width = 28) {
  const pct = total > 0 ? val / total : 0;
  const filled = Math.round(pct * width);
  const b = "█".repeat(filled) + "░".repeat(width - filled);
  const pctStr = (pct * 100).toFixed(1).padStart(5);
  return `  ${label.padEnd(18)} ${b} ${pctStr}%  (${val.toLocaleString()})`;
}

function divider(char = "─", len = 60) {
  return char.repeat(len);
}

// ─── Data pools ───────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "Kai","Alex","Jordan","Morgan","Riley","Casey","Taylor","Blake","Quinn","Avery",
  "Sage","River","Skylar","Rowan","Phoenix","Cameron","Logan","Drew","Finley","Hayden",
  "Jamie","Jesse","Emery","Remy","Shay","Reese","Kendall","Parker","Corey","Dana",
  "Marco","Zara","Niko","Mila","Deven","Sasha","Yuki","Kira","Theo","Luna",
  "Ace","Nova","Rex","Ivy","Leo","Wren","Sol","Ash","Bay","Cruz",
];

const LAST_NAMES = [
  "Rivera","Chen","Nakamura","West","Okafor","Patel","Kim","Santos","Müller","Dubois",
  "Silva","Tanaka","Rossi","Andersen","García","Kowalski","Petrov","Nguyen","Ali","Osei",
  "Yamamoto","Ferreira","Johansson","Mensah","Volkov","Bakr","Reyes","Kato","Nkosi","Bauer",
  "Storm","Vibe","Flux","Ryde","Peak","Bold","Edge","Rush","Flow","Haze",
];

const STREAM_TITLES = [
  "POV: Morning Run Through the City",
  "GoPro Night Ride — Neon Streets",
  "Meta Glasses NYC Walk 🗽",
  "RTMP Studio Session — Uncut",
  "POV Skate Park — New Tricks",
  "Sunrise Mountain Trail POV",
  "Urban Exploration POV",
  "POV: Behind the Wheel Night Drive",
  "Festival POV — Full Experience",
  "POV Kitchen: 3AM Cooking Session",
  "Gym POV — Chest Day Grind",
  "POV Motorbike — Highway Cruise",
  "Rooftop Hang with the Crew",
  "POV Surf Session — Ocean View",
  "Studio Build: New Setup POV",
  "POV Photography Walk — Downtown",
  "Warehouse Session POV 🔥",
  "POV: Commute in Tokyo",
  "Late Night POV — City Vibes",
  "Meta Glasses Beach Day",
  "GoPro Snowboard POV",
  "POV Parkour — Urban Free Run",
  "Concert POV — Front Row",
  "POV Cooking Competition",
  "RTMP: DJ Set Live",
];

const CLIP_TITLES = [
  "That moment was INSANE 🔥",
  "Nobody saw this coming",
  "Best angle of the night",
  "Peak POV content right here",
  "The crowd went WILD",
  "AI clipped this automatically",
  "You won't believe this view",
  "This is why I go live",
  "Unreal moment caught on POV",
  "The lighting was perfect",
  "Auto-clip: Top moment",
  "Viral moment incoming",
];

const NOTIFICATION_TEMPLATES = [
  { type: "new_follower" as const, title: "New Follower", message: "{{name}} started following you" },
  { type: "stream_live" as const, title: "You went live!", message: "Your stream is now live on {{platform}}" },
  { type: "clip_ready" as const, title: "Clip Ready", message: "Your AI clip '{{title}}' is ready to publish" },
  { type: "subscription" as const, title: "Subscription Active", message: "Welcome to VYBE {{plan}}! You're all set." },
  { type: "system" as const, title: "Platform Update", message: "New multistream quality improvements deployed" },
  { type: "moderation" as const, title: "Stream Notice", message: "Your stream reached 1,000 concurrent viewers!" },
];

const PLATFORMS = ["youtube", "twitch", "kick", "facebook", "instagram", "tiktok"] as const;
const DEVICES = ["phone", "gopro", "meta_glasses", "external_rtmp"] as const;
const PLANS = ["free", "pro", "enterprise"] as const;

// ─── Stats tracking ───────────────────────────────────────────────────────────

interface SimStats {
  users: number;
  liveStreams: number;
  endedStreams: number;
  scheduledStreams: number;
  totalStreams: number;
  totalClips: number;
  aiClips: number;
  platformConnections: number;
  notifications: number;
  subscriptions: number;
  totalViewers: number;
  totalChatMessages: number;
  peakConcurrentViewers: number;
  deviceCounts: Record<string, number>;
  platformCounts: Record<string, number>;
  planCounts: Record<string, number>;
  clipPublishes: number;
  totalWatchHours: number;
}

const stats: SimStats = {
  users: 0, liveStreams: 0, endedStreams: 0, scheduledStreams: 0,
  totalStreams: 0, totalClips: 0, aiClips: 0, platformConnections: 0,
  notifications: 0, subscriptions: 0, totalViewers: 0, totalChatMessages: 0,
  peakConcurrentViewers: 0, deviceCounts: {}, platformCounts: {}, planCounts: {},
  clipPublishes: 0, totalWatchHours: 0,
};

// ─── Pre-compute ──────────────────────────────────────────────────────────────

const PASSWORD_HASH = await bcrypt.hash("VybeLive2025!", 10);

// Find existing plan IDs
const plans = await db.select().from(subscriptionPlansTable).limit(10);
const freePlan = plans.find(p => p.name.toLowerCase().includes("free") || p.price === 0);
const proPlan = plans.find(p => p.name.toLowerCase().includes("pro"));
const entPlan = plans.find(p => p.name.toLowerCase().includes("enterprise"));

// ─── Clear old sim data ───────────────────────────────────────────────────────

console.log("\n" + divider("═"));
console.log("  VYBE LIVE — Platform Stress Simulation");
console.log("  1,000 Creators · All POV Tools · All Platforms");
console.log(divider("═"));
console.log();
console.log("  [1/6] Clearing previous simulation data…");

await db.execute(sql`
  DELETE FROM ${usersTable}
  WHERE username LIKE 'sim_%'
`);
log("✓ Previous simulation data cleared");

// ─── Phase 1: Create 1000 users ───────────────────────────────────────────────

console.log();
console.log("  [2/6] Spawning 1,000 simulated creators…");

const userIds: string[] = [];
const userPlans: string[] = [];

for (let batch = 0; batch < TOTAL_USERS / BATCH_SIZE; batch++) {
  const batchUsers = [];

  for (let i = 0; i < BATCH_SIZE; i++) {
    const globalIdx = batch * BATCH_SIZE + i;
    const id = uid();
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const displayName = `${firstName} ${lastName}`;
    const username = `sim_${firstName.toLowerCase()}${lastName.toLowerCase()}${globalIdx}`;

    // Plan distribution: 60% free, 30% pro, 10% enterprise
    const planRoll = Math.random();
    const plan = planRoll < 0.6 ? "free" : planRoll < 0.9 ? "pro" : "enterprise";

    // Follower counts weighted by plan
    const baseFollowers = plan === "enterprise" ? rand(50000, 500000)
      : plan === "pro" ? rand(5000, 80000)
      : rand(0, 8000);

    stats.planCounts[plan] = (stats.planCounts[plan] ?? 0) + 1;
    userIds.push(id);
    userPlans.push(plan);

    batchUsers.push({
      id,
      email: `${username}@vybe.sim`,
      username,
      displayName,
      passwordHash: PASSWORD_HASH,
      bio: `POV creator · ${pick(["🎥", "🏔️", "🛹", "🏄", "🎵", "🏋️", "🏍️", "🌆"])} ${pick(["Streaming daily", "POV life", "Always live", "Full send", "No filter", "Raw content"])}`,
      plan: plan as "free" | "pro" | "enterprise",
      followersCount: baseFollowers,
      totalStreams: 0,
      totalClips: 0,
    });
  }

  await db.insert(usersTable).values(batchUsers);
  stats.users += batchUsers.length;
  process.stdout.write(`\r  ↳ Created ${stats.users}/${TOTAL_USERS} creators…`);
}
process.stdout.write(`\r  ✓ ${TOTAL_USERS} creators spawned across all plans\n`);

// ─── Phase 2: Connect platforms ───────────────────────────────────────────────

console.log();
console.log("  [3/6] Connecting streaming platforms…");

const platformBatches: Array<typeof platformsTable.$inferInsert> = [];

for (let i = 0; i < userIds.length; i++) {
  const userId = userIds[i];
  const plan = userPlans[i];

  // Platform count by plan
  const maxPlatforms = plan === "enterprise" ? 6 : plan === "pro" ? 4 : rand(1, 3);
  const numPlatforms = rand(1, Math.min(maxPlatforms, PLATFORMS.length));
  const selected = pickN([...PLATFORMS], numPlatforms);

  for (const platform of selected) {
    platformBatches.push({
      id: uid(),
      userId,
      name: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Channel`,
      type: platform,
      rtmpUrl: `rtmp://live.${platform}.com/app`,
      streamKey: `sk_${uid().slice(0, 16)}`,
      isActive: true,
      isConnected: true,
      channelName: `@${uid().slice(0, 8)}`,
    });
    stats.platformCounts[platform] = (stats.platformCounts[platform] ?? 0) + 1;
    stats.platformConnections++;
  }
}

// Insert platforms in batches
for (let i = 0; i < platformBatches.length; i += 100) {
  await db.insert(platformsTable).values(platformBatches.slice(i, i + 100));
  process.stdout.write(`\r  ↳ Connected ${Math.min(i + 100, platformBatches.length)}/${platformBatches.length} platform accounts…`);
}
process.stdout.write(`\r  ✓ ${stats.platformConnections.toLocaleString()} platform accounts connected\n`);

// ─── Phase 3: Launch streams ──────────────────────────────────────────────────

console.log();
console.log("  [4/6] Launching streams across all POV devices…");

const streamRows: Array<typeof streamsTable.$inferInsert> = [];
const streamsByUser: Map<string, string[]> = new Map();

// Device distribution: phone 45%, gopro 25%, meta_glasses 20%, external_rtmp 10%
function pickDevice(): typeof DEVICES[number] {
  const r = Math.random();
  if (r < 0.45) return "phone";
  if (r < 0.70) return "gopro";
  if (r < 0.90) return "meta_glasses";
  return "external_rtmp";
}

// Stream count distribution: 40% users have 0 streams, rest have 1-20
let liveStreamersCount = 0;

for (let i = 0; i < userIds.length; i++) {
  const userId = userIds[i];
  const plan = userPlans[i];

  // Skip 40% of free users (lurkers / newly signed up)
  if (plan === "free" && Math.random() < 0.4) continue;

  const numStreams = plan === "enterprise" ? rand(8, 20)
    : plan === "pro" ? rand(3, 12)
    : rand(1, 5);

  streamsByUser.set(userId, []);

  for (let s = 0; s < numStreams; s++) {
    const streamId = uid();
    const device = pickDevice();
    const userPlatforms = platformBatches
      .filter(p => p.userId === userId)
      .map(p => p.type as string);
    const activePlatforms = pickN(userPlatforms, rand(1, Math.min(userPlatforms.length, 4)));

    // Status: ~3.5% are live right now, 70% ended, 26.5% scheduled
    const statusRoll = Math.random();
    let status: "live" | "ended" | "scheduled";
    let startedAt: Date | undefined;
    let endedAt: Date | undefined;
    let duration = 0;
    // NOTE: The viewer numbers below are SYNTHETIC seed data for the dev
    // database only. They are NOT used at runtime — live streams derive real
    // peak/avg/total viewers from the Agora RTC session (see stream/pov.tsx and
    // the /streams/:id/end endpoint). Do not treat this seeding as production
    // viewer logic.
    let peakViewers = 0;
    let avgViewers = 0;
    let totalViews = 0;

    if (statusRoll < 0.035 && liveStreamersCount < 35) {
      status = "live";
      liveStreamersCount++;
      stats.liveStreams++;
      startedAt = hoursAgo(rand(0, 4));
      peakViewers = rand(200, 25000);
      avgViewers = Math.round(peakViewers * randFloat(0.4, 0.8));
      totalViews = rand(peakViewers, peakViewers * 3);

      // Simulate live chat messages
      const chatPerPlatform = rand(50, 800);
      const totalChat = chatPerPlatform * activePlatforms.length;
      stats.totalChatMessages += totalChat;
    } else if (statusRoll < 0.735) {
      status = "ended";
      stats.endedStreams++;
      const daysBack = rand(0, 90);
      startedAt = daysAgo(daysBack);
      duration = rand(600, 21600); // 10min – 6hrs
      endedAt = new Date(startedAt.getTime() + duration * 1000);
      peakViewers = rand(10, 15000);
      avgViewers = Math.round(peakViewers * randFloat(0.3, 0.75));
      totalViews = rand(avgViewers, peakViewers * 5);

      const watchHours = (avgViewers * (duration / 3600));
      stats.totalWatchHours += watchHours;

      // Past chat
      const chatPerPlatform = rand(20, 3000);
      stats.totalChatMessages += chatPerPlatform * activePlatforms.length;
    } else {
      status = "scheduled";
      stats.scheduledStreams++;
      startedAt = undefined;
    }

    stats.totalViewers += peakViewers;
    if (peakViewers > stats.peakConcurrentViewers) {
      stats.peakConcurrentViewers = peakViewers;
    }
    stats.deviceCounts[device] = (stats.deviceCounts[device] ?? 0) + 1;

    streamRows.push({
      id: streamId,
      userId,
      title: pick(STREAM_TITLES),
      description: "Full POV stream · No cuts",
      status,
      deviceType: device,
      streamKey: `sk_${uid().slice(0, 16)}`,
      rtmpIngestUrl: `rtmp://ingest.vybe.live/live`,
      livekitRoomId: status === "live" ? `room_${uid().slice(0, 12)}` : undefined,
      peakViewers,
      avgViewers,
      totalViews,
      durationSeconds: duration,
      platforms: activePlatforms,
      startedAt: startedAt ?? null,
      endedAt: endedAt ?? null,
    });

    streamsByUser.get(userId)!.push(streamId);
    stats.totalStreams++;
  }
}

// Insert streams in batches of 100
for (let i = 0; i < streamRows.length; i += 100) {
  await db.insert(streamsTable).values(streamRows.slice(i, i + 100));
  process.stdout.write(`\r  ↳ Launched ${Math.min(i + 100, streamRows.length).toLocaleString()}/${streamRows.length.toLocaleString()} streams…`);
}
process.stdout.write(`\r  ✓ ${stats.totalStreams.toLocaleString()} streams launched (${stats.liveStreams} LIVE right now)\n`);

// Update user stream counts
for (const [userId, sIds] of streamsByUser) {
  if (sIds.length > 0) {
    await db.update(usersTable)
      .set({ totalStreams: sIds.length })
      .where(eq(usersTable.id, userId));
  }
}

// ─── Phase 4: Generate AI clips ───────────────────────────────────────────────

console.log();
console.log("  [5/6] AI clip generation across all streams…");

const clipRows: Array<typeof clipsTable.$inferInsert> = [];

for (const [userId, sIds] of streamsByUser) {
  // ~55% of users with streams get clips generated
  if (Math.random() > 0.55) continue;

  const numClips = rand(1, 8);
  const streamId = sIds.length > 0 ? pick(sIds) : undefined;

  for (let c = 0; c < numClips; c++) {
    const isAI = Math.random() < 0.7;
    const isPublished = Math.random() < 0.5;
    const platforms = isPublished ? pickN([...PLATFORMS], rand(1, 3)).map(p => p as string) : [];
    const clipViews = isPublished ? rand(100, 2_500_000) : 0;

    clipRows.push({
      id: uid(),
      userId,
      streamId: streamId ?? null,
      title: pick(CLIP_TITLES),
      description: isAI ? "Auto-generated by VYBE AI" : "Manual clip",
      durationSeconds: randFloat(15, 120),
      status: isPublished ? "published" : rand(0, 1) === 0 ? "ready" : "processing",
      aiGenerated: isAI,
      aspectRatio: pick(["vertical", "horizontal", "square"] as const),
      views: clipViews,
      publishedPlatforms: platforms,
      captionText: isPublished ? `${pick(["🔥", "🎥", "💯", "🚀", "✨"])} POV content #vybe #live #pov` : undefined,
    });

    if (isAI) stats.aiClips++;
    if (isPublished) stats.clipPublishes++;
    stats.totalClips++;
  }
}

for (let i = 0; i < clipRows.length; i += 100) {
  await db.insert(clipsTable).values(clipRows.slice(i, i + 100));
  process.stdout.write(`\r  ↳ Generated ${Math.min(i + 100, clipRows.length).toLocaleString()}/${clipRows.length.toLocaleString()} clips…`);
}
process.stdout.write(`\r  ✓ ${stats.totalClips.toLocaleString()} clips generated (${stats.aiClips.toLocaleString()} AI-powered)\n`);

// Update clip counts on users
for (const [userId, sIds] of streamsByUser) {
  const userClips = clipRows.filter(c => c.userId === userId).length;
  if (userClips > 0) {
    await db.update(usersTable).set({ totalClips: userClips }).where(eq(usersTable.id, userId));
  }
}

// ─── Phase 5: Notifications ───────────────────────────────────────────────────

const notifRows: Array<typeof notificationsTable.$inferInsert> = [];

for (const userId of userIds) {
  const numNotifs = rand(1, 12);
  for (let n = 0; n < numNotifs; n++) {
    const tmpl = pick(NOTIFICATION_TEMPLATES);
    notifRows.push({
      id: uid(),
      userId,
      type: tmpl.type,
      title: tmpl.title,
      message: tmpl.message.replace("{{name}}", pick(FIRST_NAMES)).replace("{{platform}}", pick([...PLATFORMS])).replace("{{title}}", pick(CLIP_TITLES)).replace("{{plan}}", pick(["Pro", "Enterprise"])),
      read: Math.random() < 0.6,
    });
    stats.notifications++;
  }
}

for (let i = 0; i < notifRows.length; i += 200) {
  await db.insert(notificationsTable).values(notifRows.slice(i, i + 200));
}

// ─── Phase 6: Subscriptions ───────────────────────────────────────────────────

if (proPlan || entPlan) {
  const subRows: Array<typeof subscriptionsTable.$inferInsert> = [];

  for (let i = 0; i < userIds.length; i++) {
    const plan = userPlans[i];
    if (plan === "free") continue;

    const planRow = plan === "enterprise" ? entPlan : proPlan;
    if (!planRow) continue;

    subRows.push({
      id: uid(),
      userId: userIds[i],
      planId: planRow.id,
      planName: planRow.name,
      status: Math.random() < 0.92 ? "active" : pick(["trialing", "past_due"] as const),
      currentPeriodEnd: new Date(Date.now() + rand(1, 30) * 86_400_000),
      cancelAtPeriodEnd: Math.random() < 0.08,
      stripeSubscriptionId: `sub_${uid().slice(0, 14)}`,
    });
    stats.subscriptions++;
  }

  for (let i = 0; i < subRows.length; i += 100) {
    await db.insert(subscriptionsTable).values(subRows.slice(i, i + 100));
  }
}

// ─── Final report ─────────────────────────────────────────────────────────────

const elapsed = ((Date.now() - SIM_START) / 1000).toFixed(1);

// Query live DB for ground-truth totals
const [dbUsers] = await db.select({ total: count() }).from(usersTable).where(sql`username LIKE 'sim_%'`);
const [dbStreams] = await db.select({ total: count() }).from(streamsTable);
const [dbLive] = await db.select({ total: count() }).from(streamsTable).where(eq(streamsTable.status, "live"));
const [dbClips] = await db.select({ total: count() }).from(clipsTable);
const [peakRow] = await db.select({ peak: max(streamsTable.peakViewers) }).from(streamsTable);
const [viewsRow] = await db.select({ total: sum(streamsTable.totalViews) }).from(streamsTable);

await pool.end();

console.log();
console.log(divider("═"));
console.log("  SIMULATION COMPLETE — Results");
console.log(divider("═"));
console.log();
console.log(`  ⏱  Completed in ${elapsed}s`);
console.log();

console.log("  ┌─ PLATFORM ACTIVITY ─────────────────────────────────────────┐");
console.log(`  │  Total creators simulated   ${String(dbUsers.total).padStart(10).padEnd(28)}           │`);
console.log(`  │  Streams launched           ${String(dbStreams.total).padStart(10).padEnd(28)}           │`);
console.log(`  │  Live streams RIGHT NOW      ${String(dbLive.total).padStart(9).padEnd(28)}           │`);
console.log(`  │  AI clips generated         ${String(stats.totalClips).padStart(10).padEnd(28)}           │`);
console.log(`  │  Platform connections        ${String(stats.platformConnections).padStart(9).padEnd(28)}           │`);
console.log(`  │  Notifications fired         ${String(stats.notifications).padStart(9).padEnd(28)}           │`);
console.log(`  │  Subscriptions (paid)        ${String(stats.subscriptions).padStart(9).padEnd(28)}           │`);
console.log("  └─────────────────────────────────────────────────────────────┘");
console.log();

console.log("  ┌─ VIEWERSHIP & ENGAGEMENT ───────────────────────────────────┐");
console.log(`  │  Peak concurrent viewers    ${String(peakRow.peak?.toLocaleString() ?? 0).padStart(10).padEnd(28)}           │`);
console.log(`  │  Total views across all     ${String(Number(viewsRow.total ?? 0).toLocaleString()).padStart(10).padEnd(28)}           │`);
console.log(`  │  Total chat messages sim.   ${String(stats.totalChatMessages.toLocaleString()).padStart(10).padEnd(28)}           │`);
console.log(`  │  Est. watch hours           ${String(Math.round(stats.totalWatchHours).toLocaleString()).padStart(10).padEnd(28)}           │`);
console.log(`  │  Clips published            ${String(stats.clipPublishes).padStart(10).padEnd(28)}           │`);
console.log(`  │  AI-generated clips         ${String(stats.aiClips).padStart(10).padEnd(28)}           │`);
console.log("  └─────────────────────────────────────────────────────────────┘");
console.log();

// Stream status breakdown
console.log("  STREAM STATUS BREAKDOWN");
console.log(bar("🔴 Live Now", stats.liveStreams, stats.totalStreams));
console.log(bar("✅ Ended", stats.endedStreams, stats.totalStreams));
console.log(bar("📅 Scheduled", stats.scheduledStreams, stats.totalStreams));
console.log();

// POV device breakdown
console.log("  POV DEVICE USAGE");
const totalDevices = Object.values(stats.deviceCounts).reduce((a, b) => a + b, 0);
console.log(bar("📱 Phone", stats.deviceCounts.phone ?? 0, totalDevices));
console.log(bar("🎥 GoPro", stats.deviceCounts.gopro ?? 0, totalDevices));
console.log(bar("👓 Meta Glasses", stats.deviceCounts.meta_glasses ?? 0, totalDevices));
console.log(bar("📡 RTMP", stats.deviceCounts.external_rtmp ?? 0, totalDevices));
console.log();

// Platform breakdown
console.log("  PLATFORM CONNECTIONS");
const totalPlatConns = Object.values(stats.platformCounts).reduce((a, b) => a + b, 0);
for (const [plat, cnt] of Object.entries(stats.platformCounts).sort(([, a], [, b]) => b - a)) {
  const label = `${plat.charAt(0).toUpperCase() + plat.slice(1)}`;
  console.log(bar(label, cnt, totalPlatConns));
}
console.log();

// Plan distribution
console.log("  CREATOR PLAN DISTRIBUTION");
const totalPlans = Object.values(stats.planCounts).reduce((a, b) => a + b, 0);
console.log(bar("🆓 Free", stats.planCounts.free ?? 0, totalPlans));
console.log(bar("⭐ Pro", stats.planCounts.pro ?? 0, totalPlans));
console.log(bar("🏢 Enterprise", stats.planCounts.enterprise ?? 0, totalPlans));
console.log();
console.log(divider("═"));
console.log("  Database seeded. All 1,000 creators are active in VYBE LIVE.");
console.log(divider("═"));
console.log();
