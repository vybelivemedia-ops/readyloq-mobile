import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Enums ───────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["creator", "admin"]);
export const userPlanEnum = pgEnum("user_plan", ["free", "pro", "enterprise"]);
export const streamStatusEnum = pgEnum("stream_status", ["scheduled", "live", "ended"]);
export const deviceTypeEnum = pgEnum("device_type", ["phone", "gopro", "meta_glasses", "external_rtmp", "usb_camera", "webrtc"]);
export const platformTypeEnum = pgEnum("platform_type", ["youtube", "twitch", "kick", "facebook", "instagram", "tiktok", "custom_rtmp"]);
export const clipStatusEnum = pgEnum("clip_status", ["processing", "ready", "published", "failed"]);
export const clipAspectRatioEnum = pgEnum("clip_aspect_ratio", ["vertical", "horizontal", "square"]);
// P3 AI Highlights: output format families with distinct duration/framing intent.
export const clipFormatEnum = pgEnum("clip_format", ["highlight", "reel", "short", "story"]);
// Creator review gate — only "approved" clips may be published.
export const clipReviewStatusEnum = pgEnum("clip_review_status", ["pending", "approved", "rejected"]);
// Append-only learning signal: what the creator (or audience) did with a clip.
export const clipOutcomeEnum = pgEnum("clip_outcome", ["generated", "approved", "rejected", "published", "deleted"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "past_due", "canceled", "trialing"]);
export const subscriptionIntervalEnum = pgEnum("subscription_interval", ["monthly", "yearly"]);
export const notificationTypeEnum = pgEnum("notification_type", ["new_follower", "stream_live", "clip_ready", "subscription", "moderation", "system", "collaboration"]);
export const reportReasonEnum = pgEnum("report_reason", ["spam", "harassment", "copyright", "inappropriate", "other"]);
export const reportTargetTypeEnum = pgEnum("report_target_type", ["stream", "clip", "user"]);
export const reportStatusEnum = pgEnum("report_status", ["pending", "reviewed", "resolved", "dismissed"]);
export const streamSessionStatusEnum = pgEnum("stream_session_status", ["live", "ended", "failed"]);
export const oauthPlatformEnum = pgEnum("oauth_platform", ["youtube", "facebook", "instagram", "twitch", "kick"]);
export const oauthConnectionStatusEnum = pgEnum("oauth_connection_status", ["connected", "refresh_needed", "expired", "error", "disconnected"]);
export const streamDestinationStatusEnum = pgEnum("stream_destination_status", ["connecting", "live", "reconnecting", "failed", "offline"]);
export const clipJobStatusEnum = pgEnum("clip_job_status", ["queued", "running", "completed", "failed"]);
export const clipJobTypeEnum = pgEnum("clip_job_type", ["generate_clips", "generate_captions", "publish", "trim_clip"]);
export const contentPostStatusEnum = pgEnum("content_post_status", ["pending", "publishing", "published", "failed"]);
export const creatorTypeEnum = pgEnum("creator_type", ["content_creator", "car_enthusiast", "fitness_trainer", "performer", "business", "event_organizer", "other"]);
export const contentCategoryEnum = pgEnum("content_category", ["automotive", "fitness", "business", "real_estate", "podcast", "gaming", "music", "lifestyle", "travel", "food", "education", "tech", "sports", "other"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "pending_deletion", "suspended", "deleted"]);
export const deletionRequestStatusEnum = pgEnum("deletion_request_status", ["pending", "completed", "cancelled"]);
export const deletionRequestSourceEnum = pgEnum("deletion_request_source", ["app", "web"]);
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system", "admin"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "image", "video", "shared_clip", "shared_stream", "shared_profile"]);
export const collaborationTypeEnum = pgEnum("collaboration_type", ["co_stream", "joint_podcast", "event", "other"]);
export const collaborationStatusEnum = pgEnum("collaboration_status", ["pending", "accepted", "declined", "scheduled", "cancelled"]);

// ─── Users ───────────────────────────────────────────────────────────────────
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum("role").default("creator").notNull(),
  plan: userPlanEnum("plan").default("free").notNull(),
  followersCount: integer("followers_count").default(0).notNull(),
  followingCount: integer("following_count").default(0).notNull(),
  totalStreams: integer("total_streams").default(0).notNull(),
  totalClips: integer("total_clips").default(0).notNull(),
  // ── Creator profile metadata ───────────────────────────────────────────
  category: contentCategoryEnum("category"),
  locationCity: text("location_city"),
  locationRegion: text("location_region"),
  locationCountry: text("location_country"),
  socialLinks: jsonb("social_links")
    .$type<{ platform: string; url: string }[]>()
    .default([])
    .notNull(),
  collaborationInterests: text("collaboration_interests")
    .array()
    .default([])
    .notNull(),
  refreshTokenHash: text("refresh_token_hash"),
  tokenVersion: integer("token_version").default(0).notNull(),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  // ── Account lifecycle ──────────────────────────────────────────────────
  accountStatus: accountStatusEnum("account_status").default("active").notNull(),
  lastLoginAt: timestamp("last_login_at"),
  lastActivityAt: timestamp("last_activity_at"),
  // Day-0 of the self-requested 30-day grace deletion pipeline.
  deletionRequestedAt: timestamp("deletion_requested_at"),
  // Set when the account is suspended by the inactivity pipeline (day 180).
  suspendedAt: timestamp("suspended_at"),
  // Set when the account is finally hard-disabled (data scrubbed).
  deletedAt: timestamp("deleted_at"),
  // Idempotency markers so the daily worker never sends the same email twice.
  deletionReminderSentAt: timestamp("deletion_reminder_sent_at"),
  inactivityWarnedAt: timestamp("inactivity_warned_at"),
  suspensionFinalNoticeSentAt: timestamp("suspension_final_notice_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  followersCount: true,
  followingCount: true,
  totalStreams: true,
  totalClips: true,
  refreshTokenHash: true,
  tokenVersion: true,
  onboardingCompleted: true,
  accountStatus: true,
  lastLoginAt: true,
  lastActivityAt: true,
  deletionRequestedAt: true,
  suspendedAt: true,
  deletedAt: true,
  deletionReminderSentAt: true,
  inactivityWarnedAt: true,
  suspensionFinalNoticeSentAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ─── Follows ───────────────────────────────────────────────────────────────────
export const followsTable = pgTable(
  "follows",
  {
    id: text("id").primaryKey(),
    followerId: text("follower_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    followedId: text("followed_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("follows_follower_followed_unq").on(t.followerId, t.followedId),
    index("follows_followed_idx").on(t.followedId),
    index("follows_follower_idx").on(t.followerId),
  ],
);
export type Follow = typeof followsTable.$inferSelect;

// ─── Streams ──────────────────────────────────────────────────────────────────
export const streamsTable = pgTable("streams", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: streamStatusEnum("status").default("scheduled").notNull(),
  deviceType: deviceTypeEnum("device_type").default("phone"),
  thumbnailUrl: text("thumbnail_url"),
  streamKey: text("stream_key"),
  rtmpIngestUrl: text("rtmp_ingest_url"),
  livekitRoomId: text("livekit_room_id"),
  peakViewers: integer("peak_viewers").default(0).notNull(),
  avgViewers: doublePrecision("avg_viewers").default(0).notNull(),
  totalViews: integer("total_views").default(0).notNull(),
  durationSeconds: integer("duration_seconds").default(0).notNull(),
  platforms: text("platforms").array().default([]).notNull(),
  recordingUrl: text("recording_url"),
  clipsCount: integer("clips_count").default(0).notNull(),
  agoraPushTaskId: text("agora_push_task_id"),
  agoraPublishUid: integer("agora_publish_uid"),
  cloudRecordingResourceId: text("cloud_recording_resource_id"),
  cloudRecordingSid: text("cloud_recording_sid"),
  // Set when recording finalization failed terminally (e.g. Agora stop failed,
  // returned no files, or no usable recording URL could be built). Surfaces a
  // clear "failed" archive status to the creator instead of a perpetual "pending".
  recordingError: text("recording_error"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStreamSchema = createInsertSchema(streamsTable).omit({
  id: true,
  peakViewers: true,
  avgViewers: true,
  totalViews: true,
  durationSeconds: true,
  clipsCount: true,
  agoraPushTaskId: true,
  agoraPublishUid: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
});
export type InsertStream = z.infer<typeof insertStreamSchema>;
export type Stream = typeof streamsTable.$inferSelect;

// ─── Platforms ────────────────────────────────────────────────────────────────
export const platformsTable = pgTable("platforms", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: platformTypeEnum("type").notNull(),
  rtmpUrl: text("rtmp_url"),
  streamKey: text("stream_key"),
  isActive: boolean("is_active").default(true).notNull(),
  isConnected: boolean("is_connected").default(true).notNull(),
  avatarUrl: text("avatar_url"),
  channelName: text("channel_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPlatformSchema = createInsertSchema(platformsTable).omit({ id: true, createdAt: true });
export type InsertPlatform = z.infer<typeof insertPlatformSchema>;
export type Platform = typeof platformsTable.$inferSelect;

// ─── OAuth Platform Connections ───────────────────────────────────────────────
// Stores OAuth-connected accounts with encrypted tokens. Separate from
// platformsTable (manual RTMP) — OAuth drives automatic multistreaming.
export const oauthConnectionsTable = pgTable("oauth_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  platform: oauthPlatformEnum("platform").notNull(),
  platformUserId: text("platform_user_id"),
  accountName: text("account_name"),
  profileImageUrl: text("profile_image_url"),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scopes: text("scopes").array().default([]).notNull(),
  status: oauthConnectionStatusEnum("status").default("connected").notNull(),
  errorMessage: text("error_message"),
  platformBroadcastId: text("platform_broadcast_id"),
  platformStreamId: text("platform_stream_id"),
  // Facebook Live destination target. "profile" streams to the user's personal
  // timeline (via the user access token); "page" streams to a managed Page (via
  // the page access token, encrypted at rest in encryptedTargetToken). Null is
  // treated as "profile" for backward compatibility.
  targetType: text("target_type"),
  targetId: text("target_id"),
  targetName: text("target_name"),
  encryptedTargetToken: text("encrypted_target_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OAuthConnection = typeof oauthConnectionsTable.$inferSelect;

// ─── Stream Destinations ───────────────────────────────────────────────────────
// Per-stream, per-platform destination with live health tracking and Agora task IDs.
export const streamDestinationsTable = pgTable("stream_destinations", {
  id: text("id").primaryKey(),
  streamId: text("stream_id").notNull().references(() => streamsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  oauthConnectionId: text("oauth_connection_id").references(() => oauthConnectionsTable.id, { onDelete: "set null" }),
  rtmpUrl: text("rtmp_url"),
  streamKey: text("stream_key"),
  status: streamDestinationStatusEnum("status").default("offline").notNull(),
  bitrateKbps: integer("bitrate_kbps").default(0).notNull(),
  viewerCount: integer("viewer_count").default(0).notNull(),
  reconnectAttempts: integer("reconnect_attempts").default(0).notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  errorMessage: text("error_message"),
  agoraPushTaskId: text("agora_push_task_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type StreamDestination = typeof streamDestinationsTable.$inferSelect;

// ─── Clips ────────────────────────────────────────────────────────────────────
export const clipsTable = pgTable("clips", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  streamId: text("stream_id").references(() => streamsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  durationSeconds: doublePrecision("duration_seconds").default(0).notNull(),
  status: clipStatusEnum("status").default("processing").notNull(),
  aiGenerated: boolean("ai_generated").default(false).notNull(),
  aspectRatio: clipAspectRatioEnum("aspect_ratio").default("vertical").notNull(),
  views: integer("views").default(0).notNull(),
  publishedPlatforms: text("published_platforms").array().default([]).notNull(),
  captionText: text("caption_text"),
  startTimeMs: integer("start_time_ms"),
  endTimeMs: integer("end_time_ms"),
  processingJobId: text("processing_job_id"),
  aiTitle: text("ai_title"),
  aiHashtags: text("ai_hashtags").array().default([]).notNull(),
  aiCaptionTiktok: text("ai_caption_tiktok"),
  aiCaptionYoutube: text("ai_caption_youtube"),
  aiCaptionInstagram: text("ai_caption_instagram"),
  aiCaptionFacebook: text("ai_caption_facebook"),
  // ── P3 AI Highlights: confidence, scoring, format & review gate ──────────
  clipFormat: clipFormatEnum("clip_format").default("short").notNull(),
  // Clip Confidence 0..1 — combined intent + signal score (null for legacy clips).
  confidence: doublePrecision("confidence"),
  // Human-readable reason, e.g. "Marked by voice + audio spike".
  confidenceReason: text("confidence_reason"),
  // Creator Intent Score (markers) and context Signal Score, kept for transparency.
  intentScore: doublePrecision("intent_score"),
  signalScore: doublePrecision("signal_score"),
  // Framing decision recorded for honesty, e.g. "center-crop 9:16".
  cropMode: text("crop_mode"),
  // Review gate. Generated clips start "pending"; only "approved" can publish.
  reviewStatus: clipReviewStatusEnum("review_status").default("pending").notNull(),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClipSchema = createInsertSchema(clipsTable).omit({
  id: true,
  views: true,
  publishedPlatforms: true,
  aiTitle: true,
  aiHashtags: true,
  aiCaptionTiktok: true,
  aiCaptionYoutube: true,
  aiCaptionInstagram: true,
  aiCaptionFacebook: true,
  startTimeMs: true,
  endTimeMs: true,
  processingJobId: true,
  clipFormat: true,
  confidence: true,
  confidenceReason: true,
  intentScore: true,
  signalScore: true,
  cropMode: true,
  reviewStatus: true,
  approvedAt: true,
  createdAt: true,
});
export type InsertClip = z.infer<typeof insertClipSchema>;
export type Clip = typeof clipsTable.$inferSelect;

// ─── Subscription Plans ───────────────────────────────────────────────────────
export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: doublePrecision("price").notNull(),
  interval: subscriptionIntervalEnum("interval").notNull(),
  features: text("features").array().default([]).notNull(),
  maxPlatforms: integer("max_platforms"),
  maxClipsPerMonth: integer("max_clips_per_month"),
  maxStreamHoursPerMonth: integer("max_stream_hours_per_month"),
  stripePriceId: text("stripe_price_id"),
});
export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;

// ─── Subscriptions ────────────────────────────────────────────────────────────
export const subscriptionsTable = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
  planId: text("plan_id").notNull().references(() => subscriptionPlansTable.id),
  planName: text("plan_name").notNull(),
  status: subscriptionStatusEnum("status").default("active").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Subscription = typeof subscriptionsTable.$inferSelect;

// ─── Stripe Webhook Events (idempotency log) ──────────────────────────────────
// Stores Stripe event IDs that have already been processed. The primary key is
// the Stripe event ID (evt_*), which is globally unique. Before processing any
// incoming webhook, we check this table to prevent duplicate DB mutations when
// Stripe retries an event after a transient failure.
export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(), // Stripe event ID, e.g. evt_1AbCdEfGhI
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});
export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;

// ─── Notifications ────────────────────────────────────────────────────────────
export const notificationsTable = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Notification = typeof notificationsTable.$inferSelect;

// ─── Stream Sessions ──────────────────────────────────────────────────────────
// Tracks the lifecycle of a single Agora streaming session — from join to end.
// One session spans all platform destinations started in that stream.
export const streamSessionsTable = pgTable("stream_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  agoraChannel: text("agora_channel").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  status: streamSessionStatusEnum("status").default("live").notNull(),
  platformCount: integer("platform_count").default(0).notNull(),
  peakViewers: integer("peak_viewers").default(0).notNull(),
  failureReason: text("failure_reason"),
});

export const insertStreamSessionSchema = createInsertSchema(streamSessionsTable).omit({
  id: true,
  startedAt: true,
  endedAt: true,
});
export type InsertStreamSession = z.infer<typeof insertStreamSessionSchema>;
export type StreamSession = typeof streamSessionsTable.$inferSelect;

// ─── Password Reset Tokens ───────────────────────────────────────────────────
export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Reports ─────────────────────────────────────────────────────────────────
export const reportsTable = pgTable("reports", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetType: reportTargetTypeEnum("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: reportReasonEnum("reason").notNull(),
  details: text("details"),
  status: reportStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Report = typeof reportsTable.$inferSelect;

// ─── Clip Processing Jobs ─────────────────────────────────────────────────────
// Tracks async FFmpeg + AI processing jobs. One job per pipeline run.
export const clipJobsTable = pgTable("clip_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  streamId: text("stream_id").references(() => streamsTable.id, { onDelete: "set null" }),
  clipId: text("clip_id").references(() => clipsTable.id, { onDelete: "set null" }),
  type: clipJobTypeEnum("type").notNull(),
  status: clipJobStatusEnum("status").default("queued").notNull(),
  progress: integer("progress").default(0).notNull(),
  errorMessage: text("error_message"),
  resultData: text("result_data"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ClipJob = typeof clipJobsTable.$inferSelect;

// ─── Conversations (Direct Messages) ─────────────────────────────────────────
export const conversationsTable = pgTable("conversations", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Conversation = typeof conversationsTable.$inferSelect;

export const conversationParticipantsTable = pgTable("conversation_participants", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});
export type ConversationParticipant = typeof conversationParticipantsTable.$inferSelect;

// Structured attachment payload stored on a direct message. The `kind`
// discriminator mirrors the non-text values of messageTypeEnum. For image/video
// the `objectPath` is a private-storage `/objects/<id>` path served only to
// conversation participants via the attachment route. For shared entities only
// the referenced id is stored; previews are hydrated server-side on read.
export type MessageAttachment =
  | { kind: "image" | "video"; objectPath: string; width?: number; height?: number; durationSeconds?: number }
  | { kind: "clip"; clipId: string }
  | { kind: "stream"; streamId: string }
  | { kind: "profile"; userId: string };

export const directMessagesTable = pgTable("direct_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: messageTypeEnum("type").default("text").notNull(),
  content: text("content"),
  attachment: jsonb("attachment").$type<MessageAttachment | null>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertDirectMessageSchema = createInsertSchema(directMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type DirectMessage = typeof directMessagesTable.$inferSelect;

export const messageReactionsTable = pgTable(
  "message_reactions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull().references(() => directMessagesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("message_reactions_msg_user_emoji_unq").on(t.messageId, t.userId, t.emoji),
    index("message_reactions_message_idx").on(t.messageId),
  ],
);
export type MessageReaction = typeof messageReactionsTable.$inferSelect;

// ─── Content Posts ─────────────────────────────────────────────────────────────
// One record per clip × platform publish attempt. Source of truth for publish history.
export const contentPostsTable = pgTable("content_posts", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clipsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  status: contentPostStatusEnum("status").default("pending").notNull(),
  caption: text("caption"),
  publishedAt: timestamp("published_at"),
  externalPostId: text("external_post_id"),
  externalPostUrl: text("external_post_url"),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ContentPost = typeof contentPostsTable.$inferSelect;

// ─── Beta Waitlist ─────────────────────────────────────────────────────────────
export const betaWaitlistTable = pgTable("beta_waitlist", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  creatorType: creatorTypeEnum("creator_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBetaWaitlistSchema = createInsertSchema(betaWaitlistTable).omit({ id: true, createdAt: true });
export type BetaWaitlistEntry = typeof betaWaitlistTable.$inferSelect;

// ─── Account Deletion Requests ─────────────────────────────────────────────────
// One row per deletion request. Created by both the in-app flow (source=app,
// linked to a logged-in user) and the public web form (source=web, where the
// requester may not have an authenticated session). Drives Google Play data
// deletion compliance and the admin review dashboard.
export const deletionRequestsTable = pgTable("deletion_requests", {
  id: text("id").primaryKey(),
  // Nullable: a public web request may reference an email that has no matching account.
  userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  username: text("username"),
  reason: text("reason"),
  source: deletionRequestSourceEnum("source").notNull(),
  ipAddress: text("ip_address"),
  status: deletionRequestStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertDeletionRequestSchema = createInsertSchema(deletionRequestsTable).omit({
  id: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
});
export type DeletionRequest = typeof deletionRequestsTable.$inferSelect;

// ─── Account Audit Log ──────────────────────────────────────────────────────────
// Append-only record of every account-lifecycle event (deletion requested,
// suspended, reactivated, deleted, restored). Captures actor, IP, and a JSON
// metadata blob for compliance and admin forensics.
export const accountAuditLogTable = pgTable("account_audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  actorType: auditActorTypeEnum("actor_type").default("system").notNull(),
  ipAddress: text("ip_address"),
  // JSON-encoded contextual metadata (never store secrets/credentials here).
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AccountAuditLogEntry = typeof accountAuditLogTable.$inferSelect;

// ─── Object Upload Ledger ─────────────────────────────────────────────────────
// Records who requested each presigned upload URL, keyed by the server-issued
// object path. Lets server routes (e.g. DM attachments) verify that a referenced
// object was actually uploaded by the requesting user before binding/serving it,
// preventing object-takeover via a leaked/guessed objectPath.
export const objectUploadsTable = pgTable("object_uploads", {
  objectPath: text("object_path").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  contentType: text("content_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ObjectUpload = typeof objectUploadsTable.$inferSelect;

// ─── Collaboration Requests ───────────────────────────────────────────────────
// A structured proposal from one creator to another to work together (co-stream,
// joint podcast, event, etc.). The recipient may accept/decline/schedule; the
// sender may cancel. scheduledAt holds the proposed/agreed date-time when set.
export const collaborationRequestsTable = pgTable(
  "collaboration_requests",
  {
    id: text("id").primaryKey(),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: collaborationTypeEnum("type").notNull(),
    message: text("message").notNull(),
    status: collaborationStatusEnum("status").default("pending").notNull(),
    scheduledAt: timestamp("scheduled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("collab_to_user_idx").on(table.toUserId),
    index("collab_from_user_idx").on(table.fromUserId),
  ],
);

export const insertCollaborationRequestSchema = createInsertSchema(collaborationRequestsTable).omit({
  id: true,
  fromUserId: true,
  status: true,
  scheduledAt: true,
  createdAt: true,
  updatedAt: true,
});
export type CollaborationRequest = typeof collaborationRequestsTable.$inferSelect;

// ─── Recognition (Voice & Gesture moment-marking) ─────────────────────────────
// markerSource: what created the timeline marker.
//   voice   — a creator trigger phrase matched by on-device speech recognition
//   gesture — a recognized hand gesture from the live camera frame processor
//   manual  — the creator tapped the clip button
//   ai      — generated by the (P3) AI highlight engine
export const markerSourceEnum = pgEnum("marker_source", ["voice", "gesture", "manual", "ai"]);
export const recognitionSensitivityEnum = pgEnum("recognition_sensitivity", ["high", "medium", "low"]);

// Defaults a creator starts with — also used by the settings upsert.
export const DEFAULT_TRIGGER_PHRASES = [
  "VYBE clip that",
  "VYBE highlight",
  "Save that",
  "Mark moment",
  "Create clip",
];
export const DEFAULT_ENABLED_GESTURES = ["thumbs_up", "peace", "pointing", "open_palm"];

// Timeline markers dropped on a live stream. P3's AI clip engine reads these to
// find highlight windows (streamSecond ± contextWindowSeconds).
export const streamMarkersTable = pgTable(
  "stream_markers",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id")
      .notNull()
      .references(() => streamsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    source: markerSourceEnum("source").notNull(),
    // The matched phrase (voice) or gesture name (gesture); null for manual.
    triggerValue: text("trigger_value"),
    label: text("label"),
    // Offset into the stream, in seconds, when the marker fired.
    streamSecond: integer("stream_second").notNull(),
    // Seconds of context on each side to use when building a clip.
    contextWindowSeconds: integer("context_window_seconds").default(30).notNull(),
    // Detection confidence 0..1 (recognition sources); null for manual.
    score: doublePrecision("score"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("stream_markers_stream_idx").on(table.streamId),
    index("stream_markers_user_idx").on(table.userId),
  ],
);

export const insertStreamMarkerSchema = createInsertSchema(streamMarkersTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertStreamMarker = z.infer<typeof insertStreamMarkerSchema>;
export type StreamMarker = typeof streamMarkersTable.$inferSelect;

// Per-creator recognition configuration — exactly one row per user, keyed by
// userId. Read endpoint upserts defaults on first access.
export const recognitionSettingsTable = pgTable("recognition_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  voiceEnabled: boolean("voice_enabled").default(false).notNull(),
  gestureEnabled: boolean("gesture_enabled").default(false).notNull(),
  triggerPhrases: text("trigger_phrases").array().default(DEFAULT_TRIGGER_PHRASES).notNull(),
  enabledGestures: text("enabled_gestures").array().default(DEFAULT_ENABLED_GESTURES).notNull(),
  sensitivity: recognitionSensitivityEnum("sensitivity").default("medium").notNull(),
  contextWindowSeconds: integer("context_window_seconds").default(30).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RecognitionSettings = typeof recognitionSettingsTable.$inferSelect;

// ─── Clip Outcomes (P3 learning signal) ───────────────────────────────────────
// Append-only log of what happened to each generated clip. Drives both the
// per-creator preference profile and the anonymized universal learning engine.
// clipId is nullable so the "deleted" outcome survives the clip row deletion.
export const clipOutcomesTable = pgTable(
  "clip_outcomes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clipId: text("clip_id").references(() => clipsTable.id, { onDelete: "set null" }),
    streamId: text("stream_id").references(() => streamsTable.id, { onDelete: "set null" }),
    // Format and dominant marker source of the clip this outcome refers to.
    format: clipFormatEnum("format"),
    source: markerSourceEnum("source"),
    // JSON array of context-signal names that contributed (e.g. ["audio_spike"]).
    signals: text("signals").array().default([]).notNull(),
    confidence: doublePrecision("confidence"),
    outcome: clipOutcomeEnum("outcome").notNull(),
    // Views snapshot at the time the outcome was recorded (engagement proxy).
    views: integer("views").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("clip_outcomes_user_idx").on(table.userId),
    index("clip_outcomes_outcome_idx").on(table.outcome),
  ],
);

export type ClipOutcome = typeof clipOutcomesTable.$inferSelect;

// ─── Mission Control (Internal AI HQ) ─────────────────────────────────────────
// Founder-facing internal command center. A roster of AI "executives" each own
// tasks, hold long-term memory, and chat with the founder. Tasks can be handed
// off between executives. AI replies are placeholder for v1 (see aiExecutive
// service) but the schema is shaped so real LLM output can drop in unchanged.
export const agentRoleEnum = pgEnum("agent_role", [
  "cto",
  "qa_director",
  "release_manager",
  "product_manager",
  "creative_director",
  "marketing_director",
  "chief_of_staff",
]);
export const agentStatusEnum = pgEnum("agent_status", [
  "active",
  "busy",
  "idle",
  "offline",
  "planning",
  "collaborating",
  "needs_approval",
]);
export const agentTaskStatusEnum = pgEnum("agent_task_status", [
  "backlog",
  "in_progress",
  "blocked",
  "review",
  "done",
]);
export const agentTaskPriorityEnum = pgEnum("agent_task_priority", ["low", "medium", "high", "critical"]);
export const agentTaskOriginEnum = pgEnum("agent_task_origin", ["founder", "agent", "system"]);
export const agentMemoryKindEnum = pgEnum("agent_memory_kind", [
  "directive",
  "decision",
  "fact",
  "preference",
  "context",
]);
export const agentMessageRoleEnum = pgEnum("agent_message_role", ["founder", "agent"]);
export const agentActivityTypeEnum = pgEnum("agent_activity_type", [
  "task_created",
  "task_updated",
  "handoff",
  "message",
  "collaboration",
  "approval",
  "objective",
]);

// Objective lifecycle: the Chief of Staff decomposes a founder objective, fans it
// out to executives, and finalizes with an aggregated briefing.
export const objectiveStatusEnum = pgEnum("objective_status", [
  "planning",
  "in_progress",
  "needs_approval",
  "completed",
  "failed",
]);
// Approval gate for high-impact executive recommendations.
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "deferred",
]);

// ─── AI Executives ────────────────────────────────────────────────────────────
export const aiExecutivesTable = pgTable("ai_executives", {
  id: text("id").primaryKey(),
  role: agentRoleEnum("role").notNull().unique(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  tagline: text("tagline").notNull(),
  bio: text("bio").notNull(),
  status: agentStatusEnum("status").default("active").notNull(),
  statusMessage: text("status_message"),
  accentColor: text("accent_color").notNull(),
  avatarInitials: text("avatar_initials").notNull(),
  specialties: text("specialties").array().default([]).notNull(),
  // Placeholder model identifier — swap for a real model id when AI is wired up.
  model: text("model").default("vybe-core-1").notNull(),
  // System prompt steering the (future) real LLM for this executive's persona.
  systemPrompt: text("system_prompt").default("").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAiExecutiveSchema = createInsertSchema(aiExecutivesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiExecutive = z.infer<typeof insertAiExecutiveSchema>;
export type AiExecutive = typeof aiExecutivesTable.$inferSelect;

// ─── Agent Tasks ──────────────────────────────────────────────────────────────
export const agentTasksTable = pgTable(
  "agent_tasks",
  {
    id: text("id").primaryKey(),
    executiveId: text("executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: agentTaskStatusEnum("status").default("backlog").notNull(),
    priority: agentTaskPriorityEnum("priority").default("medium").notNull(),
    origin: agentTaskOriginEnum("origin").default("founder").notNull(),
    // Set when an executive (not the founder) created or handed off this task.
    createdByExecutiveId: text("created_by_executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    // Set when this task is a child of a Chief-of-Staff objective fan-out.
    objectiveId: text("objective_id").references((): AnyPgColumn => agentObjectivesTable.id, {
      onDelete: "set null",
    }),
    progress: integer("progress").default(0).notNull(),
    dueAt: timestamp("due_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("agent_tasks_executive_idx").on(t.executiveId),
    index("agent_tasks_status_idx").on(t.status),
    index("agent_tasks_priority_idx").on(t.priority),
  ],
);

export const insertAgentTaskSchema = createInsertSchema(agentTasksTable).omit({
  id: true,
  progress: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTaskRow = typeof agentTasksTable.$inferSelect;

// ─── Agent Handoffs ───────────────────────────────────────────────────────────
export const agentHandoffsTable = pgTable(
  "agent_handoffs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => agentTasksTable.id, { onDelete: "cascade" }),
    fromExecutiveId: text("from_executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    toExecutiveId: text("to_executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_handoffs_task_idx").on(t.taskId)],
);
export type AgentHandoff = typeof agentHandoffsTable.$inferSelect;

// ─── Agent Memory ─────────────────────────────────────────────────────────────
export const agentMemoryTable = pgTable(
  "agent_memory",
  {
    id: text("id").primaryKey(),
    executiveId: text("executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    kind: agentMemoryKindEnum("kind").default("context").notNull(),
    content: text("content").notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_memory_executive_idx").on(t.executiveId)],
);

export const insertAgentMemorySchema = createInsertSchema(agentMemoryTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemoryRow = typeof agentMemoryTable.$inferSelect;

// ─── Agent Messages (founder ↔ executive chat) ────────────────────────────────
export const agentMessagesTable = pgTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    executiveId: text("executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    role: agentMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_messages_executive_idx").on(t.executiveId)],
);
export type AgentMessageRow = typeof agentMessagesTable.$inferSelect;

// ─── Agent Activity (HQ feed) ─────────────────────────────────────────────────
export const agentActivityTable = pgTable(
  "agent_activity",
  {
    id: text("id").primaryKey(),
    type: agentActivityTypeEnum("type").notNull(),
    executiveId: text("executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_activity_created_idx").on(t.createdAt)],
);
export type AgentActivityRow = typeof agentActivityTable.$inferSelect;

// ─── Agent Reports (real project-awareness output) ────────────────────────────
// Each executive's capability inspects real workspace resources (codebase, tests,
// build/deploy state, roadmap, design assets, marketing) and persists a
// structured report here. The Chief of Staff aggregates the latest report from
// each executive into one briefing. metrics/findings are JSON so the report shape
// can evolve without migrations.
export const agentReportStatusEnum = pgEnum("agent_report_status", [
  "healthy",
  "attention",
  "critical",
]);

export type ReportMetric = { label: string; value: string; hint?: string };
export type ReportFinding = { severity: "info" | "warning" | "critical"; text: string };
// A concrete next action an executive recommends. High-impact recommendations
// are escalated into the approval workflow during objective orchestration.
export type ReportRecommendation = { text: string; impact: "low" | "medium" | "high" };

export const agentReportsTable = pgTable(
  "agent_reports",
  {
    id: text("id").primaryKey(),
    executiveId: text("executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    // V5: when a report is produced as part of a Chief-of-Staff objective fan-out,
    // it is scoped to that objective so the briefing aggregates only this
    // objective's workstream reports (not the exec's unrelated global latest).
    objectiveId: text("objective_id").references((): AnyPgColumn => agentObjectivesTable.id, {
      onDelete: "set null",
    }),
    status: agentReportStatusEnum("status").default("healthy").notNull(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull(),
    metrics: jsonb("metrics").$type<ReportMetric[]>().default([]).notNull(),
    findings: jsonb("findings").$type<ReportFinding[]>().default([]).notNull(),
    // V5 enrichment: confidence (0-100), recommended actions, follow-ups, and a
    // rough effort estimate. Defaulted so legacy reads stay valid.
    confidence: integer("confidence").default(80).notNull(),
    recommendations: jsonb("recommendations")
      .$type<ReportRecommendation[]>()
      .default([])
      .notNull(),
    followUps: jsonb("follow_ups").$type<string[]>().default([]).notNull(),
    estimatedEffort: text("estimated_effort"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_reports_executive_idx").on(t.executiveId, t.createdAt)],
);
export type AgentReportRow = typeof agentReportsTable.$inferSelect;

// ─── Phase 3: Objective State Engine JSON shapes ──────────────────────────────
// These types are used as $type<> annotations on JSONB columns in
// agentObjectivesTable. They live here so @workspace/db is the single
// import for anything that touches the DB layer.

export type ObjectiveExecutionEntry = {
  id: string;
  /** ISO 8601 timestamp string. */
  timestamp: string;
  action: string;
  source: string;
  outcome: "success" | "failed" | "skipped" | "in_progress";
  durationMs?: number;
  detail?: string;
};

export type ObjectiveLearningEntry = {
  id: string;
  timestamp: string;
  topic: string;
  insight: string;
  /** Confidence 0–100. */
  confidence: number;
  source: string;
};

export type ObjectiveNextAction = {
  kind: string;
  description: string;
  assignedTo?: string;
  requiredBy?: string;
  estimatedEffort?: string;
};

// ─── Agent Objectives (Chief-of-Staff orchestration) ──────────────────────────
// A founder objective the Chief of Staff decomposes into child tasks across
// executives, then finalizes with one aggregated briefing report.
export const agentObjectivesTable = pgTable(
  "agent_objectives",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    request: text("request").notNull(),
    status: objectiveStatusEnum("status").default("planning").notNull(),
    // Chief's plan rationale (AI or deterministic fallback).
    summary: text("summary"),
    createdByExecutiveId: text("created_by_executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    // The aggregated briefing report produced when the objective completes.
    briefingReportId: text("briefing_report_id").references(() => agentReportsTable.id, {
      onDelete: "set null",
    }),
    // ─── Phase 3: Persistent State Engine ─────────────────────────────
    // Which executive role slug owns this objective (e.g. "cto").
    ownerRole: text("owner_role"),
    // Processing priority: low | medium | high | critical.
    priority: text("priority").default("medium").notNull(),
    // IDs of other objectives this one depends on (blocking dependencies).
    dependencies: jsonb("dependencies").$type<string[]>().default([]).notNull(),
    // Completion progress 0–100.
    progressPercent: integer("progress_percent").default(0).notNull(),
    // Number of times execution has been retried after failure.
    retryCount: integer("retry_count").default(0).notNull(),
    // Append-only log of every action taken against this objective.
    executionHistory: jsonb("execution_history")
      .$type<ObjectiveExecutionEntry[]>()
      .default([])
      .notNull(),
    // Append-only log of insights extracted during this objective's lifecycle.
    learningHistory: jsonb("learning_history")
      .$type<ObjectiveLearningEntry[]>()
      .default([])
      .notNull(),
    // What an executive recommends should happen next.
    nextAction: jsonb("next_action").$type<ObjectiveNextAction>(),
    // Stable semantic identifier used for idempotency checks.
    // The autonomy engine stores a short key here (e.g. "portfolio:user_growth:vybe-live",
    // "engineering:vybe-live", "blocker:task:abc") so every creation path can do an indexed
    // lookup before inserting — preventing duplicate objectives for the same intent.
    dedupKey: text("dedup_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("agent_objectives_status_idx").on(t.status),
    index("agent_objectives_owner_idx").on(t.ownerRole),
    index("agent_objectives_dedup_idx").on(t.dedupKey),
  ],
);
export type AgentObjectiveRow = typeof agentObjectivesTable.$inferSelect;

// ─── Agent Approvals (high-impact recommendation gate) ────────────────────────
export const agentApprovalsTable = pgTable(
  "agent_approvals",
  {
    id: text("id").primaryKey(),
    objectiveId: text("objective_id").references(() => agentObjectivesTable.id, {
      onDelete: "cascade",
    }),
    executiveId: text("executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => agentTasksTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    impact: text("impact").default("high").notNull(),
    status: approvalStatusEnum("status").default("pending").notNull(),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("agent_approvals_status_idx").on(t.status),
    index("agent_approvals_objective_idx").on(t.objectiveId),
  ],
);
export type AgentApprovalRow = typeof agentApprovalsTable.$inferSelect;

// ─── Exec Collaboration Events (V6.4 Collaboration Engine) ───────────────────
// Logs every inter-executive communication event during objective orchestration.
// Events are append-only; resolved = true once the receiving exec has acted.
export const execCollabEventTypeEnum = pgEnum("exec_collab_event_type", [
  "ask_assistance",
  "share_findings",
  "transfer_task",
  "request_review",
  "report_dependency",
  "update_progress",
]);

export const execCollabEventsTable = pgTable(
  "exec_collab_events",
  {
    id: text("id").primaryKey(),
    objectiveId: text("objective_id")
      .notNull()
      .references((): AnyPgColumn => agentObjectivesTable.id, { onDelete: "cascade" }),
    fromExecutiveId: text("from_executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    // null = broadcast to all execs on the objective
    toExecutiveId: text("to_executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    taskId: text("task_id").references((): AnyPgColumn => agentTasksTable.id, {
      onDelete: "set null",
    }),
    eventType: execCollabEventTypeEnum("event_type").notNull(),
    content: text("content").notNull(),
    // Structured payload: e.g. { finding, severity, blockedBy, transferReason }
    metadata: jsonb("metadata").$type<Record<string, string>>().default({}).notNull(),
    resolved: boolean("resolved").default(false).notNull(),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("exec_collab_events_objective_idx").on(t.objectiveId, t.createdAt),
    index("exec_collab_events_from_idx").on(t.fromExecutiveId),
    index("exec_collab_events_to_idx").on(t.toExecutiveId),
  ],
);

export type ExecCollabEventRow = typeof execCollabEventsTable.$inferSelect;
export type ExecCollabEventType = typeof execCollabEventTypeEnum.enumValues[number];

// ─── AI Usage Log (V6.2 Intelligence Layer) ───────────────────────────────────
// Tracks every AI provider call made by Quinn or an executive capability.
// Used for cost awareness, per-exec attribution, and the Mission Control
// AI metrics panel. Provider and task are plain text (not enums) so adding
// ─── Founder Operating Profile ──────────────────────────────────────────────
// Quinn learns how the Founder operates — never assumes, only learns from
// repeated behavior or explicit statements.

export const founderProfileCategoryEnum = pgEnum("founder_profile_category", [
  "communication_style",
  "decision_patterns",
  "risk_tolerance",
  "release_philosophy",
  "product_priorities",
  "company_priorities",
  "approval_habits",
  "work_schedule",
  "executive_trust",
  "strategic_goals",
]);

export const founderProfileConfidenceEnum = pgEnum("founder_profile_confidence", [
  "low",    // 1–2 observations
  "medium", // 3–5 observations
  "high",   // 6+ observations
]);

export const founderProfileSourceEnum = pgEnum("founder_profile_source", [
  "observed",  // inferred from repeated behavior
  "explicit",  // founder stated it directly
]);

export const founderProfileInsightsTable = pgTable(
  "founder_profile_insights",
  {
    id: text("id").primaryKey(),
    category: founderProfileCategoryEnum("category").notNull(),
    insight: text("insight").notNull(),
    confidence: founderProfileConfidenceEnum("confidence").notNull().default("low"),
    source: founderProfileSourceEnum("source").notNull().default("observed"),
    evidence: jsonb("evidence").notNull().$type<string[]>().default([]),
    observationCount: integer("observation_count").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    lastObservedAt: timestamp("last_observed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("fpi_category_idx").on(t.category, t.confidence),
    index("fpi_active_idx").on(t.isActive, t.lastObservedAt),
  ],
);
export type FounderProfileInsightRow = typeof founderProfileInsightsTable.$inferSelect;

// ─── V6.8 Founder Decision Model ──────────────────────────────────────────────
// Quinn predicts how the Founder would decide BEFORE recommending. Each
// prediction is recorded and later scored against the Founder's actual decision,
// so the model's self-knowledge (accuracy) improves continuously by observation.
export const founderDecisionPredictionsTable = pgTable(
  "founder_decision_predictions",
  {
    id: text("id").primaryKey(),
    // The approval this prediction is about (null = a free-form recommendation).
    approvalId: text("approval_id").references(() => agentApprovalsTable.id, {
      onDelete: "cascade",
    }),
    objectiveId: text("objective_id").references(
      (): AnyPgColumn => agentObjectivesTable.id,
      { onDelete: "set null" },
    ),
    // Human-readable description of the decision being predicted.
    context: text("context").notNull(),
    // What Quinn predicted the Founder would choose (e.g. "approve" / "reject").
    predictedChoice: text("predicted_choice").notNull(),
    // Confidence in the prediction — reuses the profile confidence scale.
    confidence: founderProfileConfidenceEnum("confidence").notNull().default("low"),
    rationale: text("rationale").notNull(),
    // Profile insight labels/ids the prediction was grounded in.
    basedOn: jsonb("based_on").notNull().$type<string[]>().default([]),
    // Filled in once the Founder actually decides.
    actualOutcome: text("actual_outcome"),
    wasCorrect: boolean("was_correct"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("fdp_approval_idx").on(t.approvalId),
    index("fdp_scored_idx").on(t.wasCorrect, t.createdAt),
  ],
);
export type FounderDecisionPredictionRow =
  typeof founderDecisionPredictionsTable.$inferSelect;

// new providers never requires a schema migration.
export const aiUsageLogTable = pgTable(
  "ai_usage_log",
  {
    id: text("id").primaryKey(),
    executiveId: text("executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    objectiveId: text("objective_id").references(
      (): AnyPgColumn => agentObjectivesTable.id,
      { onDelete: "set null" },
    ),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    totalTokens: integer("total_tokens").default(0).notNull(),
    estimatedCostUsd: doublePrecision("estimated_cost_usd").default(0).notNull(),
    latencyMs: integer("latency_ms").default(0).notNull(),
    success: boolean("success").default(true).notNull(),
    fromFallback: boolean("from_fallback").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("ai_usage_log_executive_idx").on(t.executiveId, t.createdAt),
    index("ai_usage_log_created_idx").on(t.createdAt),
  ],
);
export type AiUsageLogRow = typeof aiUsageLogTable.$inferSelect;

// ─── V6.6 Daily COO Briefing ──────────────────────────────────────────────────
// One row per calendar day (UTC). Idempotent — the service never generates twice
// for the same date. Sections stored as JSON so the schema never needs a
// migration when we add/rename sections.
export const dailyCOOBriefingsTable = pgTable(
  "daily_coo_briefings",
  {
    id: text("id").primaryKey(),
    // YYYY-MM-DD in UTC — unique key, one briefing per day
    date: text("date").notNull().unique(),
    // JSON object keyed by section name, value = { headline, content, items?, urgency? }
    sections: jsonb("sections").notNull(),
    // Token / cost accounting from the generation call
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    estimatedCostUsd: doublePrecision("estimated_cost_usd").default(0).notNull(),
    // When the AI actually finished writing this briefing
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("dcb_date_idx").on(t.date)],
);
export type DailyCOOBriefingRow = typeof dailyCOOBriefingsTable.$inferSelect;

// ─── V7: Portfolio Monitoring ─────────────────────────────────────────────────
// Mission Control manages a PORTFOLIO of companies, not a single app. Each asset
// is a monitored portfolio member. VYBE Live has a live monitor (reads real DB
// state); ReadyLoq (and any future company) registers as an asset and is served
// by a placeholder monitor until it has live telemetry. No app-specific logic is
// hardcoded into the loop — adding a company is just a registration row here.
export const portfolioMonitorTypeEnum = pgEnum("portfolio_monitor_type", [
  "live",
  "placeholder",
]);

export const portfolioAssetsTable = pgTable(
  "portfolio_assets",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    monitorType: portfolioMonitorTypeEnum("monitor_type").default("placeholder").notNull(),
    // External telemetry config — when set, the generic external monitor can
    // ping the production URL and read GitHub activity for this asset.
    liveUrl: text("live_url"),
    githubRepo: text("github_repo"),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("portfolio_assets_active_idx").on(t.isActive, t.sortOrder)],
);
export type PortfolioAssetRow = typeof portfolioAssetsTable.$inferSelect;

// ─── V7: Executive Learning Engine ────────────────────────────────────────────
// Every completed objective produces a retrospective; each executive accumulates
// a permanent knowledge base (lessons, decisions, collaboration, communication,
// founder feedback, improvements). Quinn distills lessons weekly and distributes
// them across the team. Learning is permanent unless reset via Developer Tools.
export const executiveLessonKindEnum = pgEnum("executive_lesson_kind", [
  "lesson_learned",
  "successful_decision",
  "failed_decision",
  "collaboration",
  "communication",
  "founder_feedback",
  "improvement",
]);
export const executiveLessonSourceEnum = pgEnum("executive_lesson_source", [
  "retrospective", // generated from an objective retrospective
  "weekly_review", // produced during Quinn's weekly review
  "distributed", // a lesson Quinn shared from another exec during weekly review
  "manual", // recorded directly
]);

export const executiveLessonsTable = pgTable(
  "executive_lessons",
  {
    id: text("id").primaryKey(),
    role: agentRoleEnum("role").notNull(),
    kind: executiveLessonKindEnum("kind").notNull(),
    content: text("content").notNull(),
    objectiveId: text("objective_id").references((): AnyPgColumn => agentObjectivesTable.id, {
      onDelete: "set null",
    }),
    source: executiveLessonSourceEnum("source").default("retrospective").notNull(),
    // Relative importance — repeated/distributed lessons accrue weight.
    weight: integer("weight").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("executive_lessons_role_idx").on(t.role, t.createdAt)],
);
export type ExecutiveLessonRow = typeof executiveLessonsTable.$inferSelect;

export const objectiveRetrospectivesTable = pgTable(
  "objective_retrospectives",
  {
    id: text("id").primaryKey(),
    objectiveId: text("objective_id")
      .notNull()
      .references((): AnyPgColumn => agentObjectivesTable.id, { onDelete: "cascade" }),
    // null = team-level retrospective; otherwise scoped to one executive role.
    role: agentRoleEnum("role"),
    whatWorked: text("what_worked").default("").notNull(),
    whatFailed: text("what_failed").default("").notNull(),
    whatToDoDifferently: text("what_to_do_differently").default("").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("objective_retrospectives_objective_idx").on(t.objectiveId)],
);
export type ObjectiveRetrospectiveRow = typeof objectiveRetrospectivesTable.$inferSelect;

export const weeklyReviewsTable = pgTable(
  "weekly_reviews",
  {
    id: text("id").primaryKey(),
    // YYYY-MM-DD of the Monday (UTC) the review covers — unique, one per week.
    weekOf: text("week_of").notNull().unique(),
    recurringMistakes: jsonb("recurring_mistakes").$type<string[]>().default([]).notNull(),
    recurringSuccesses: jsonb("recurring_successes").$type<string[]>().default([]).notNull(),
    collaborationImprovements: jsonb("collaboration_improvements")
      .$type<string[]>()
      .default([])
      .notNull(),
    orgRecommendations: jsonb("org_recommendations").$type<string[]>().default([]).notNull(),
    distributedCount: integer("distributed_count").default(0).notNull(),
    summary: text("summary").default("").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("weekly_reviews_week_idx").on(t.weekOf)],
);
export type WeeklyReviewRow = typeof weeklyReviewsTable.$inferSelect;

// ─── V7: Autonomy Engine (Quinn's continuous "what should happen next?") ───────
// Each cycle inspects the portfolio, executive workload, objectives, blockers,
// approvals, reports, and founder priorities, then either acts autonomously
// (safe actions only) or escalates. Every run is logged for the Autonomy page
// and Diagnostics. DEV runs manually; PROD runs every 15 min via a worker.
export const autonomyTriggerEnum = pgEnum("autonomy_trigger", ["manual", "scheduled"]);
export const autonomyCycleStatusEnum = pgEnum("autonomy_cycle_status", [
  "completed", // took at least one action or escalation
  "noop", // nothing meaningful to do
  "failed", // cycle threw
]);
export type AutonomyAction = { type: string; detail: string };
export type AutonomyEscalation = { reason: string; detail: string };

export const autonomyCyclesTable = pgTable(
  "autonomy_cycles",
  {
    id: text("id").primaryKey(),
    trigger: autonomyTriggerEnum("trigger").notNull(),
    status: autonomyCycleStatusEnum("status").default("noop").notNull(),
    // Snapshot of the signals Quinn saw this cycle (for explainability).
    signals: jsonb("signals").$type<Record<string, unknown>>().default({}).notNull(),
    actions: jsonb("actions").$type<AutonomyAction[]>().default([]).notNull(),
    escalations: jsonb("escalations").$type<AutonomyEscalation[]>().default([]).notNull(),
    summary: text("summary").default("").notNull(),
    durationMs: integer("duration_ms").default(0).notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("autonomy_cycles_created_idx").on(t.createdAt)],
);
export type AutonomyCycleRow = typeof autonomyCyclesTable.$inferSelect;

// ─── V8: Living Organization ──────────────────────────────────────────────────
// The company's memory. Every major event across Mission Control is appended to
// one ledger so the Organization Timeline, organizational-memory lookups, and
// the Living Dashboard all read from a single curated source of truth. This is
// distinct from the operational `activity` micro-feed — these are the curated,
// founder-visible moments that define the company's history.
export const organizationEventTypeEnum = pgEnum("organization_event_type", [
  "objective",
  "conversation",
  "approval",
  "learning",
  "founder_decision",
  "portfolio",
  "milestone",
  "briefing",
  "recommendation",
  "reflection",
]);
export const eventImportanceEnum = pgEnum("event_importance", [
  "low",
  "normal",
  "high",
  "critical",
]);

export const organizationEventsTable = pgTable(
  "organization_events",
  {
    id: text("id").primaryKey(),
    type: organizationEventTypeEnum("type").notNull(),
    title: text("title").notNull(),
    summary: text("summary").default("").notNull(),
    // The executive most responsible for the event (null = system/founder).
    actorExecutiveId: text("actor_executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    // Loose pointer to the originating record (e.g. "objective"/objId) so the
    // timeline can deep-link without rigid FKs across every event source.
    refType: text("ref_type"),
    refId: text("ref_id"),
    // V9: cause→effect chains. Points at the prior event that *caused* this one,
    // so the Timeline can render connected chains (objective → discussion →
    // approval → deploy → issue → lesson) and a chain can be followed end to end.
    causedByEventId: text("caused_by_event_id").references(
      (): AnyPgColumn => organizationEventsTable.id,
      { onDelete: "set null" },
    ),
    importance: eventImportanceEnum("importance").default("normal").notNull(),
    // Searchable keywords powering organizational-memory lookups.
    keywords: text("keywords").array().default([]).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("organization_events_created_idx").on(t.createdAt),
    index("organization_events_type_idx").on(t.type, t.createdAt),
  ],
);
export type OrganizationEventRow = typeof organizationEventsTable.$inferSelect;

// Executive-to-executive conversations (not tied to a single objective). These
// are the natural cross-functional exchanges that make the org feel alive —
// e.g. Ada flags a deployment risk, Theo delays release, Mara runs regression,
// Quinn adjusts priorities.
export const execConversationStatusEnum = pgEnum("exec_conversation_status", [
  "open",
  "resolved",
]);

export const execConversationsTable = pgTable(
  "exec_conversations",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    summary: text("summary").default("").notNull(),
    status: execConversationStatusEnum("status").default("open").notNull(),
    initiatedByExecutiveId: text("initiated_by_executive_id").references(
      () => aiExecutivesTable.id,
      { onDelete: "set null" },
    ),
    // Optional link to an objective if the conversation spawned or relates to one.
    objectiveId: text("objective_id").references((): AnyPgColumn => agentObjectivesTable.id, {
      onDelete: "set null",
    }),
    messageCount: integer("message_count").default(0).notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("exec_conversations_status_idx").on(t.status, t.lastMessageAt)],
);
export type ExecConversationRow = typeof execConversationsTable.$inferSelect;

export const execConversationMessagesTable = pgTable(
  "exec_conversation_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => execConversationsTable.id, { onDelete: "cascade" }),
    fromExecutiveId: text("from_executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    sequence: integer("sequence").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("exec_conversation_messages_conversation_idx").on(t.conversationId, t.sequence),
  ],
);
export type ExecConversationMessageRow = typeof execConversationMessagesTable.$inferSelect;

// Executive Initiative — executives proactively propose work; Quinn (chief of
// staff) reviews each and either dismisses it or converts it into an objective.
// Recommendations may reference a prior organization event (organizational
// memory) so the team learns from previous outcomes.
export const recommendationStatusEnum = pgEnum("recommendation_status", [
  "pending",
  "accepted",
  "dismissed",
  "converted",
]);
export const recommendationCategoryEnum = pgEnum("recommendation_category", [
  "onboarding",
  "technical_debt",
  "launch",
  "process",
  "growth",
  "quality",
  "strategy",
]);

export const executiveRecommendationsTable = pgTable(
  "executive_recommendations",
  {
    id: text("id").primaryKey(),
    proposedByExecutiveId: text("proposed_by_executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    category: recommendationCategoryEnum("category").default("process").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    status: recommendationStatusEnum("status").default("pending").notNull(),
    // Organizational-memory linkage: a prior event this proposal references
    // (e.g. a previous attempt that failed).
    priorEventId: text("prior_event_id").references(() => organizationEventsTable.id, {
      onDelete: "set null",
    }),
    // Set when Quinn converts the recommendation into an objective.
    objectiveId: text("objective_id").references((): AnyPgColumn => agentObjectivesTable.id, {
      onDelete: "set null",
    }),
    // ── V9: full justification block ──────────────────────────────────────────
    // Concrete evidence lines behind the proposal (signals/metrics observed).
    evidence: jsonb("evidence").$type<string[]>().default([]).notNull(),
    // Executive conversation(s) that motivated this recommendation.
    supportingConversationIds: jsonb("supporting_conversation_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    // Objective(s) this proposal relates to (prior or in-flight).
    relatedObjectiveIds: jsonb("related_objective_ids").$type<string[]>().default([]).notNull(),
    // Executive-memory entries the proposal drew on (so cards can cite them).
    citedMemoryIds: jsonb("cited_memory_ids").$type<string[]>().default([]).notNull(),
    // Confidence score 0–100 (deterministically computed from supporting signals).
    confidence: integer("confidence").default(50).notNull(),
    // Expected business impact, in plain language.
    expectedImpact: text("expected_impact").default("").notNull(),
    // Quinn's note when she reviews the recommendation.
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("executive_recommendations_status_idx").on(t.status, t.createdAt)],
);
export type ExecutiveRecommendationRow = typeof executiveRecommendationsTable.$inferSelect;

// ─── V9: Connected Intelligence ───────────────────────────────────────────────
// Per-executive durable memory. Every executive carries what they've worked on,
// the mistakes and successes they've had, who they collaborate with, the
// corrections the Founder has given them, the workflows they prefer, and the
// risk areas they watch. Recommendations cite the specific memories they drew on.
export const executiveMemoryKindEnum = pgEnum("executive_memory_kind", [
  "project", // a past project or objective they led/contributed to
  "mistake", // something that went wrong they should not repeat
  "success", // a win worth repeating
  "collaborator", // an executive they frequently work with
  "founder_correction", // a correction/preference the Founder gave them
  "workflow", // a preferred way of working
  "risk_area", // a recurring risk they watch
]);

export const executiveMemoryTable = pgTable(
  "executive_memory",
  {
    id: text("id").primaryKey(),
    executiveId: text("executive_id")
      .notNull()
      .references(() => aiExecutivesTable.id, { onDelete: "cascade" }),
    kind: executiveMemoryKindEnum("kind").notNull(),
    content: text("content").notNull(),
    // Repeated observations accrue weight so the strongest memories surface first.
    weight: integer("weight").default(1).notNull(),
    // Loose pointer to the originating record (objective/conversation/event).
    refType: text("ref_type"),
    refId: text("ref_id"),
    keywords: text("keywords").array().default([]).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("executive_memory_exec_idx").on(t.executiveId, t.kind)],
);
export type ExecutiveMemoryRow = typeof executiveMemoryTable.$inferSelect;

// Quinn's internal reasoning trace. Before she answers the Founder she runs an
// explicit reasoning pass (six questions); each pass is persisted so the chat
// surface can expose *how* she arrived at her reply rather than hiding it.
export const chiefReasoningTable = pgTable(
  "chief_reasoning",
  {
    id: text("id").primaryKey(),
    // The Founder message that triggered this reasoning pass.
    founderMessage: text("founder_message").notNull(),
    // The six question→answer reasoning steps.
    steps: jsonb("steps").$type<{ question: string; answer: string }[]>().default([]).notNull(),
    // The reply Quinn ultimately gave (for context alongside the reasoning).
    reply: text("reply").default("").notNull(),
    reasoningIntent: text("reasoning_intent"),
    // Whether Quinn decided to coordinate the team without asking the Founder.
    coordinated: boolean("coordinated").default(false).notNull(),
    coordinationNote: text("coordination_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("chief_reasoning_created_idx").on(t.createdAt)],
);
export type ChiefReasoningRow = typeof chiefReasoningTable.$inferSelect;

// ─── Engineering Intelligence Snapshots (V10) ───────────────────────────────
// The single source of engineering truth for Mission Control. The Engineering
// Intelligence Layer collects telemetry from pluggable providers (GitHub,
// Replit, and future ones), normalizes it into ONE deterministic snapshot, and
// persists it here. Executives and Quinn consume only this snapshot — never the
// providers directly. Queryable summary columns sit alongside the full
// normalized snapshot JSON (used by the dashboard and trend detection).
export const engineeringSnapshotsTable = pgTable(
  "engineering_snapshots",
  {
    id: text("id").primaryKey(),
    // V10 portfolio-aware: every snapshot belongs to a product (portfolio asset).
    // Empty string denotes legacy rows captured before portfolio-awareness; new
    // rows always carry the owning portfolio_assets.id.
    productId: text("product_id").default("").notNull(),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
    // Overall health
    healthScore: integer("health_score").default(0).notNull(),
    // Global Launch Readiness Score (0–100) — a top-level executive metric.
    launchReadinessScore: integer("launch_readiness_score").default(0).notNull(),
    deploymentRisk: text("deployment_risk").default("unknown").notNull(),
    launchRisk: text("launch_risk").default("unknown").notNull(),
    blockers: text("blockers").array().default([]).notNull(),
    // Repository summary
    branch: text("branch").default("").notNull(),
    latestCommitSha: text("latest_commit_sha").default("").notNull(),
    latestCommitMessage: text("latest_commit_message").default("").notNull(),
    openPullRequests: integer("open_pull_requests").default(0).notNull(),
    openIssues: integer("open_issues").default(0).notNull(),
    // Build / deployment / runtime summary
    buildStatus: text("build_status").default("unknown").notNull(),
    deploymentStatus: text("deployment_status").default("unknown").notNull(),
    runtimeStatus: text("runtime_status").default("unknown").notNull(),
    errorCount: integer("error_count").default(0).notNull(),
    // Provider connectivity diagnostics
    providers: jsonb("providers")
      .$type<
        {
          name: string;
          status: "connected" | "degraded" | "unavailable";
          latencyMs: number;
          error: string | null;
          lastSyncAt: string | null;
        }[]
      >()
      .default([])
      .notNull(),
    // Full normalized EngineeringSnapshot (repository/build/deployment/runtime)
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => [
    index("engineering_snapshots_captured_at_idx").on(t.capturedAt),
    index("engineering_snapshots_product_captured_idx").on(t.productId, t.capturedAt),
  ],
);
export type EngineeringSnapshotRow = typeof engineeringSnapshotsTable.$inferSelect;

// ─── V10: Engineering Events ──────────────────────────────────────────────────
// Typed events emitted by comparing each snapshot against the previous one for
// the same product. They feed the timeline, executive memory, recommendations,
// the morning briefing, and autonomous cycles. Persisted historically (never
// overwritten) so deploy/release/incident history is queryable per product.
export const engineeringEventTypeEnum = pgEnum("engineering_event_type", [
  "build_failed",
  "deployment_started",
  "deployment_succeeded",
  "deployment_failed",
  "production_healthy",
  "production_degraded",
  "runtime_errors_increased",
  "runtime_errors_resolved",
  "new_pull_request",
  "critical_issue_opened",
]);

export const engineeringEventsTable = pgTable(
  "engineering_events",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").default("").notNull(),
    snapshotId: text("snapshot_id").default("").notNull(),
    type: engineeringEventTypeEnum("type").notNull(),
    severity: text("severity").default("info").notNull(), // info | warning | critical
    title: text("title").notNull(),
    detail: text("detail").default("").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("engineering_events_product_created_idx").on(t.productId, t.createdAt)],
);
export type EngineeringEventRow = typeof engineeringEventsTable.$inferSelect;

// ─── V11.1: Autonomous Blocker Resolution Engine ─────────────────────────────
// The canonical registry of organizational blockers. Mission Control no longer
// stops at identifying blockers — every blocker is classified into one of four
// categories and progressed each autonomy cycle, exhausting every autonomous
// path before escalating to the Founder. Rows are synced (deduped) from existing
// signals: blocked tasks, critical reports, engineering snapshot blockers, and
// critical portfolio dimensions. The Blocker Center dashboard reads this table.
export const blockerCategoryEnum = pgEnum("blocker_category", [
  "autonomous", // the executive team has everything needed — create work, assign, execute
  "connected", // a connected external provider can resolve it (GitHub/Replit/Stripe/…)
  "founder_approval", // work is ready but requires Founder authorization (deploy/launch/spend/pricing)
  "human_required", // the platform legally requires the account owner (identity/tax/banking/legal/biometric)
  "unclassified", // not yet classified this cycle
]);

export const blockerStatusEnum = pgEnum("blocker_status", [
  "open", // newly detected, not yet acted on
  "in_progress", // autonomous/connected resolution underway
  "awaiting_approval", // a single Founder approval request is pending
  "awaiting_human", // blocked on an out-of-band human action
  "resolved", // resolved (source cleared or resolution succeeded)
  "failed", // no autonomous path after all retries/integrations
]);

export const blockerSourceEnum = pgEnum("blocker_source", [
  "task", // agent_tasks.status = 'blocked'
  "report", // agent_reports.status = 'critical'
  "engineering", // engineering_snapshots.blockers[]
  "portfolio", // a critical portfolio dimension
  "manual", // created directly
]);

export const blockerSeverityEnum = pgEnum("blocker_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

// One attempt at resolving a blocker — appended to retryHistory every pass.
export type BlockerRetryEntry = {
  at: string; // ISO timestamp
  action: string; // what was attempted (e.g. "Assigned CTO to remediate")
  outcome: "success" | "failed" | "deferred" | "pending";
  detail: string;
};

export const blockersTable = pgTable(
  "blockers",
  {
    id: text("id").primaryKey(),
    // Where this blocker was detected and a stable natural reference to the source.
    sourceType: blockerSourceEnum("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    // sourceType + sourceRef — used to upsert/dedupe across sync passes.
    dedupeKey: text("dedupe_key").notNull(),
    // Owning product (portfolio_assets.id); empty for org-wide blockers.
    productId: text("product_id").default("").notNull(),
    // Optional linkage into the existing systems.
    objectiveId: text("objective_id").references((): AnyPgColumn => agentObjectivesTable.id, {
      onDelete: "set null",
    }),
    taskId: text("task_id").references((): AnyPgColumn => agentTasksTable.id, {
      onDelete: "set null",
    }),
    approvalId: text("approval_id").references((): AnyPgColumn => agentApprovalsTable.id, {
      onDelete: "set null",
    }),
    ownerExecutiveId: text("owner_executive_id").references(() => aiExecutivesTable.id, {
      onDelete: "set null",
    }),
    category: blockerCategoryEnum("category").default("unclassified").notNull(),
    status: blockerStatusEnum("status").default("open").notNull(),
    severity: blockerSeverityEnum("severity").default("medium").notNull(),
    title: text("title").notNull(),
    rootCause: text("root_cause").default("").notNull(),
    resolutionPlan: text("resolution_plan").default("").notNull(),
    // For "connected": the provider that can resolve it (e.g. "github", "stripe").
    connectorProvider: text("connector_provider"),
    estimatedCompletion: text("estimated_completion").default("").notNull(),
    // For "human_required": exactly what the Founder must do.
    humanAction: text("human_action").default("").notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    retryHistory: jsonb("retry_history").$type<BlockerRetryEntry[]>().default([]).notNull(),
    detail: text("detail").default("").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    uniqueIndex("blockers_dedupe_key_idx").on(t.dedupeKey),
    index("blockers_status_idx").on(t.status),
    index("blockers_category_idx").on(t.category),
    index("blockers_product_idx").on(t.productId),
  ],
);
export type BlockerRow = typeof blockersTable.$inferSelect;

// ─── Engineering Expansion: Specialist run ledger ────────────────────────────
// Every invocation of a registered specialist (Agent Registry) is recorded here.
// This is the ONLY new persistence the specialist layer adds — the registry
// itself is code-defined, and specialist findings flow into the existing
// executive report / approval / briefing pipelines. Run history drives each
// specialist's confidence score and diagnostics.
export const specialistRunsTable = pgTable(
  "specialist_runs",
  {
    id: text("id").primaryKey(),
    // Registry id, e.g. "architect-review", "devops-engineer".
    specialistId: text("specialist_id").notNull(),
    // Owning executive who invoked the specialist (Quinn routes via owners).
    executiveId: text("executive_id").references(() => aiExecutivesTable.id, { onDelete: "set null" }),
    objectiveId: text("objective_id").references(() => agentObjectivesTable.id, { onDelete: "cascade" }),
    taskId: text("task_id"),
    // What triggered the invocation (the assignment focus / founder request).
    trigger: text("trigger").default("").notNull(),
    success: boolean("success").default(false).notNull(),
    // Self-reported analysis confidence for this run (0-100).
    confidence: integer("confidence").default(0).notNull(),
    summary: text("summary").default("").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("specialist_runs_specialist_idx").on(t.specialistId),
    index("specialist_runs_created_idx").on(t.createdAt),
  ],
);
export type SpecialistRunRow = typeof specialistRunsTable.$inferSelect;

// ─── Marketing Autonomy: learning-based content publishing (Dario Sol) ───────
// Every piece of marketing content Dario drafts is stored here with the full
// learning signal set (draft vs final, founder edits, style attributes,
// confidence prediction, and engagement). The learning profile is DERIVED from
// approved rows — no duplicate memory store. Trusted Marketing Mode state lives
// in the singleton marketing_autonomy_state row, monitored by Quinn.

export const marketingContentTypeEnum = pgEnum("marketing_content_type", [
  // Low-risk (auto-publishable in Trusted Marketing Mode):
  "product_tip",
  "feature_highlight",
  "educational",
  "community_engagement",
  "creator_spotlight",
  "launch_countdown",
  "release_recap",
  // High-risk (ALWAYS requires explicit Founder approval):
  "legal_announcement",
  "pricing_change",
  "partnership_announcement",
  "investor_communication",
  "crisis_communication",
  "policy_change",
  "other",
]);
export const marketingRiskLevelEnum = pgEnum("marketing_risk_level", ["low", "high"]);
export const marketingPostStatusEnum = pgEnum("marketing_post_status", [
  "pending_approval",
  "approved",
  "rejected",
  "auto_published",
]);
export const marketingAutonomyModeEnum = pgEnum("marketing_autonomy_mode", ["learning", "trusted"]);

export type MarketingEngagement = {
  views: number;
  likes: number;
  shares: number;
  comments: number;
};

export const marketingPostsTable = pgTable(
  "marketing_posts",
  {
    id: text("id").primaryKey(),
    executiveId: text("executive_id").references(() => aiExecutivesTable.id, { onDelete: "set null" }),
    objectiveId: text("objective_id").references(() => agentObjectivesTable.id, { onDelete: "set null" }),
    // The founder/Quinn brief that prompted the draft.
    topic: text("topic").default("").notNull(),
    platform: text("platform").default("").notNull(),
    contentType: marketingContentTypeEnum("content_type").default("other").notNull(),
    riskLevel: marketingRiskLevelEnum("risk_level").default("high").notNull(),
    status: marketingPostStatusEnum("status").default("pending_approval").notNull(),
    // Learning signals: original vs final.
    originalDraft: text("original_draft").default("").notNull(),
    finalContent: text("final_content").default("").notNull(),
    founderEdited: boolean("founder_edited").default(false).notNull(),
    // Style attributes captured at draft time.
    tone: text("tone").default("").notNull(),
    lengthChars: integer("length_chars").default(0).notNull(),
    cta: text("cta").default("").notNull(),
    hashtags: jsonb("hashtags").$type<string[]>().default([]).notNull(),
    creativeAssets: jsonb("creative_assets").$type<string[]>().default([]).notNull(),
    // Confidence engine output.
    predictedConfidence: integer("predicted_confidence").default(0).notNull(),
    confidenceReasons: jsonb("confidence_reasons").$type<string[]>().default([]).notNull(),
    // Set at decision time: did the prediction match the founder's decision?
    predictionCorrect: boolean("prediction_correct"),
    autoPublished: boolean("auto_published").default(false).notNull(),
    engagement: jsonb("engagement").$type<MarketingEngagement | null>().default(null),
    postedAt: timestamp("posted_at"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("marketing_posts_status_idx").on(t.status),
    index("marketing_posts_created_idx").on(t.createdAt),
    index("marketing_posts_content_type_idx").on(t.contentType),
  ],
);
export type MarketingPostRow = typeof marketingPostsTable.$inferSelect;

export const marketingAutonomyStateTable = pgTable("marketing_autonomy_state", {
  id: text("id").primaryKey(), // singleton row: "singleton"
  mode: marketingAutonomyModeEnum("mode").default("learning").notNull(),
  // Founder kill-switch: when true, trusted mode can never activate.
  founderDisabled: boolean("founder_disabled").default(false).notNull(),
  enabledAt: timestamp("enabled_at"),
  suspendedAt: timestamp("suspended_at"),
  suspensionReason: text("suspension_reason").default("").notNull(),
  suspensionCount: integer("suspension_count").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MarketingAutonomyStateRow = typeof marketingAutonomyStateTable.$inferSelect;

// ── Social Command Center: server-persisted scheduled social posts ───────────
// Backs the Mission Control Scheduling Center. Each row is a founder-scoped
// post targeted at one connected platform, scheduled for a future time, and
// (optionally) gated behind founder approval before it is eligible to publish.
export const socialScheduledPostStatusEnum = pgEnum("social_scheduled_post_status", [
  "pending_approval", // awaiting founder approval before it can be published
  "scheduled",        // approved (or approval not required) and queued for its time
  "publishing",       // publish attempt in progress
  "published",        // successfully published
  "failed",           // publish attempt failed
  "cancelled",        // cancelled by the founder
]);

export const socialScheduledPostsTable = pgTable(
  "social_scheduled_posts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    // Optional link to the OAuth connection this post targets.
    oauthConnectionId: text("oauth_connection_id").references(() => oauthConnectionsTable.id, { onDelete: "set null" }),
    // Optional link to a VYBE clip being promoted.
    clipId: text("clip_id").references(() => clipsTable.id, { onDelete: "set null" }),
    title: text("title").default("").notNull(),
    content: text("content").default("").notNull(),
    mediaUrl: text("media_url"),
    hashtags: jsonb("hashtags").$type<string[]>().default([]).notNull(),
    scheduledAt: timestamp("scheduled_at").notNull(),
    status: socialScheduledPostStatusEnum("status").default("pending_approval").notNull(),
    // Approval trail.
    requiresApproval: boolean("requires_approval").default(true).notNull(),
    approvedAt: timestamp("approved_at"),
    // Publish outcome.
    publishedAt: timestamp("published_at"),
    externalPostId: text("external_post_id"),
    errorMessage: text("error_message"),
    // Bounded auto-retry: number of transient-failure retries already attempted.
    // Capped by the publisher so a broken post can't requeue forever.
    retryCount: integer("retry_count").default(0).notNull(),
    createdBy: text("created_by").default("founder").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("social_scheduled_posts_user_idx").on(t.userId),
    index("social_scheduled_posts_status_idx").on(t.status),
    index("social_scheduled_posts_scheduled_idx").on(t.scheduledAt),
  ],
);
export type SocialScheduledPostRow = typeof socialScheduledPostsTable.$inferSelect;

export const insertSocialScheduledPostSchema = createInsertSchema(socialScheduledPostsTable);

// ── Agent Zero: Mission Control's autonomous execution engine ────────────────
// Agent Zero is NOT an executive and NOT a planner — it executes work that
// Quinn assigns, using the existing Specialist Bench and intelligence systems.
// Jobs are long-running, checkpointed at step granularity, and support
// pause / resume / retry / cancel. Protected actions (deploy, publish, money,
// delete, legal/external comms, strategy) can never run autonomously — the job
// parks in waiting_approval until the founder decides via agent_approvals.

export const agentZeroCommandEnum = pgEnum("agent_zero_command", [
  "execute_objective",
  "investigate_engineering_failure",
  "prepare_release",
  "run_specialist_review",
  "monitor_deployment",
  "execute_marketing_campaign",
  "research_brand_partnerships",
  "audit_database",
  "generate_release_report",
  "workspace_op",
  "custom",
]);

export const agentZeroJobStatusEnum = pgEnum("agent_zero_job_status", [
  "queued",
  "running",
  "paused",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const agentZeroStepKindEnum = pgEnum("agent_zero_step_kind", [
  "specialist",
  "capability",
  "engineering_snapshot",
  "portfolio_health",
  "marketing_intelligence",
  "diagnostics",
  "analysis",
  "report",
  "replit_create_workspace",
  "replit_clone_repo",
  "replit_read_file",
  "replit_write_file",
  "replit_run_tests",
  "replit_install_packages",
  "replit_deploy_preview",
  "replit_rollback",
  "replit_stream_logs",
]);

export const agentZeroStepStatusEnum = pgEnum("agent_zero_step_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const agentZeroJobsTable = pgTable(
  "agent_zero_jobs",
  {
    id: text("id").primaryKey(),
    commandType: agentZeroCommandEnum("command_type").default("custom").notNull(),
    title: text("title").default("").notNull(),
    // The instruction Quinn issued (WHAT to execute — Agent Zero decides HOW).
    instruction: text("instruction").default("").notNull(),
    objectiveId: text("objective_id").references(() => agentObjectivesTable.id, { onDelete: "set null" }),
    // The executive that dispatched the job (always Quinn / chief_of_staff).
    requestedBy: text("requested_by").references(() => aiExecutivesTable.id, { onDelete: "set null" }),
    status: agentZeroJobStatusEnum("status").default("queued").notNull(),
    priority: integer("priority").default(5).notNull(),
    progress: integer("progress").default(0).notNull(), // 0-100
    currentStep: text("current_step").default("").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    lastError: text("last_error").default("").notNull(),
    // Deterministic root-cause bucket set on terminal failure.
    rootCause: text("root_cause").default("").notNull(),
    resultSummary: text("result_summary").default("").notNull(),
    // Set when the job parks for founder sign-off on a protected action.
    approvalId: text("approval_id"),
    // Execution lease: set at claim time; every runner write is gated on it so a
    // stale runner (after retry/resume/cancel re-claims) can never write.
    leaseToken: text("lease_token"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    pausedAt: timestamp("paused_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("agent_zero_jobs_status_idx").on(t.status),
    index("agent_zero_jobs_created_idx").on(t.createdAt),
  ],
);
export type AgentZeroJobRow = typeof agentZeroJobsTable.$inferSelect;

export const agentZeroStepsTable = pgTable(
  "agent_zero_steps",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .references(() => agentZeroJobsTable.id, { onDelete: "cascade" })
      .notNull(),
    seq: integer("seq").default(0).notNull(),
    title: text("title").default("").notNull(),
    kind: agentZeroStepKindEnum("kind").default("analysis").notNull(),
    status: agentZeroStepStatusEnum("status").default("pending").notNull(),
    // For kind=specialist: which bench specialist to consult.
    specialistId: text("specialist_id").default("").notNull(),
    // For kind=capability: which executive role's capability to run.
    executiveRole: text("executive_role").default("").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    summary: text("summary").default("").notNull(),
    // Checkpoint payload — completed steps are never re-executed on resume.
    output: jsonb("output").$type<Record<string, unknown> | null>().default(null),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("agent_zero_steps_job_idx").on(t.jobId),
    index("agent_zero_steps_status_idx").on(t.status),
  ],
);
export type AgentZeroStepRow = typeof agentZeroStepsTable.$inferSelect;

// ─── AI Model Config (V12: per-scope provider/model selection) ────────────────
// Persists founder-selected AI provider / model-tier preferences. A single
// "global" row (scopeId null) sets the default active provider; "objective" rows
// override per objective. Consulted by AIProviderFactory at request time.
export const aiModelConfigScopeEnum = pgEnum("ai_model_config_scope", ["global", "objective"]);

export const aiModelConfigsTable = pgTable(
  "ai_model_configs",
  {
    id: text("id").primaryKey(),
    scope: aiModelConfigScopeEnum("scope").notNull(),
    // Null for the singleton global row; objective id for objective overrides.
    scopeId: text("scope_id"),
    // Preferred provider name (openai|anthropic|google) or null = auto priority.
    provider: text("provider"),
    // Preferred model tier hint (fast|standard|reasoning) or null = per-request.
    modelHint: text("model_hint"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("ai_model_configs_scope_idx").on(t.scope, t.scopeId),
  ],
);
export type AiModelConfigRow = typeof aiModelConfigsTable.$inferSelect;

// ─── OS Event Log — Mission Control Event Bus persistence ─────────────────────
// Every event emitted on the OS EventBus is durably written here for replay,
// audit, and debugging. The table is append-only; status transitions are the
// only permitted updates.
export const osEventsTable = pgTable(
  "os_events",
  {
    id: text("id").primaryKey(),
    /** Namespaced event kind, e.g. "github.push", "vybe.stream.started". */
    kind: text("kind").notNull(),
    /** Service / component that emitted the event. */
    source: text("source").notNull(),
    /** low | normal | high | critical */
    priority: text("priority").notNull().default("normal"),
    /** pending | processed | failed */
    status: text("status").notNull().default("pending"),
    /** Links causally related events (e.g. a chain of reactions). */
    correlationId: text("correlation_id"),
    /** Full event payload serialised as JSONB. */
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    emittedAt: timestamp("emitted_at").defaultNow().notNull(),
    /** Set when all handlers have finished processing the event. */
    processedAt: timestamp("processed_at"),
    /** Error message if status = failed. */
    error: text("error"),
  },
  (t) => [
    index("os_events_kind_idx").on(t.kind),
    index("os_events_emitted_at_idx").on(t.emittedAt),
    index("os_events_correlation_id_idx").on(t.correlationId),
    index("os_events_status_idx").on(t.status),
  ],
);
export type OsEventRow = typeof osEventsTable.$inferSelect;

// ─── Phase 10: Deployment Event History ───────────────────────────────────────
// Every artifact deployment (success or failure) is persisted here.
// Populated by ExecutiveEventBridge when replit.deploy.* events arrive.
export const deploymentTriggerEnum = pgEnum("deployment_trigger", [
  "manual",
  "autonomy_loop",
  "agent_zero",
]);

export const deploymentEventsTable = pgTable(
  "deployment_events",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id").notNull(),
    version: text("version").default("").notNull(),
    sha: text("sha").default("").notNull(),
    trigger: deploymentTriggerEnum("trigger").default("manual").notNull(),
    success: boolean("success").default(false).notNull(),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    phase: text("phase"),
    rolledBack: boolean("rolled_back").default(false).notNull(),
    rolledBackFromId: text("rolled_back_from_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("deployment_events_artifact_idx").on(t.artifactId),
    index("deployment_events_created_idx").on(t.createdAt),
  ],
);
export type DeploymentEventRow = typeof deploymentEventsTable.$inferSelect;

// ─── Phase 10: Provider Reliability Ledger ────────────────────────────────────
// Daily-bucketed success/failure/latency counts per provider+model combination.
// Updated by AIProviderFactory on every completion (upsert on conflict).
// Used by getPreferredProvider() to bias future dispatch toward reliable options.
export const providerReliabilityTable = pgTable(
  "provider_reliability",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    date: text("date").notNull(),
    successCount: integer("success_count").default(0).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    timeoutCount: integer("timeout_count").default(0).notNull(),
    totalTokens: integer("total_tokens").default(0).notNull(),
    avgLatencyMs: integer("avg_latency_ms").default(0).notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    index("provider_reliability_provider_idx").on(t.provider, t.model, t.date),
  ],
);
export type ProviderReliabilityRow = typeof providerReliabilityTable.$inferSelect;
