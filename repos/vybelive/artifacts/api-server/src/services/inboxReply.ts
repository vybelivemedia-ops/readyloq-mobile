/**
 * inboxReply — pure orchestration for the Social Command Center "reply to inbox
 * item" flow. Extracted from the route handler so the honest-error contract can
 * be exercised deterministically (no DB / no network) via dependency injection.
 *
 * The contract this locks in:
 *   • invalid / empty body            → 400
 *   • unknown platform                 → 400
 *   • platform can't reply (capability)→ 422
 *   • no founder account resolved      → 422
 *   • founder not connected / reauth   → 422
 *   • upstream platform API failure    → 502
 *   • success                          → 200 { ok: true, ... }
 *
 * It NEVER fabricates a success: every failure surfaces an explicit status +
 * message so the UI can render an honest error instead of silently dropping the
 * reply or faking a delivered state.
 */

import { ReplyToSocialInboxBody } from "@workspace/api-zod";
import {
  PLATFORM_CAPABILITIES,
  type InboxReplyResult,
  type ResolvedToken,
  type SocialPlatformId,
  type Unavailable,
} from "./socialInsights.js";

export interface InboxReplyOutcome {
  status: number;
  body: Record<string, unknown>;
}

export interface InboxReplyDeps {
  resolveFounderUser: () => Promise<{ id: string } | null>;
  getFounderToken: (
    founderUserId: string,
    platform: SocialPlatformId,
  ) => Promise<ResolvedToken | Unavailable>;
  replyToYouTubeComment: (
    accessToken: string,
    parentId: string,
    text: string,
  ) => Promise<InboxReplyResult>;
  replyToFacebookComment: (
    accessToken: string,
    itemId: string,
    text: string,
  ) => Promise<InboxReplyResult>;
  replyToInstagramComment: (
    accessToken: string,
    commentId: string,
    text: string,
  ) => Promise<InboxReplyResult>;
  /** Optional error sink (wired to req.log.error in the route). */
  logError?: (err: unknown, platform: string) => void;
}

/**
 * Validate + route an inbox reply to the right platform. Returns an
 * `{ status, body }` outcome the caller sends verbatim. Pure aside from the
 * injected dependencies.
 */
export async function processInboxReply(
  rawBody: unknown,
  deps: InboxReplyDeps,
): Promise<InboxReplyOutcome> {
  const parsed = ReplyToSocialInboxBody.safeParse(rawBody);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Invalid reply request", details: parsed.error.flatten() },
    };
  }

  const text = parsed.data.text.trim();
  if (!text) {
    return { status: 400, body: { error: "Reply text cannot be empty." } };
  }

  const platform = parsed.data.platform as SocialPlatformId;
  const cap = PLATFORM_CAPABILITIES[platform];
  if (!cap) {
    return {
      status: 400,
      body: { error: `Unknown platform "${parsed.data.platform}".` },
    };
  }
  if (!cap.replySupported) {
    return {
      status: 422,
      body: { error: `Replies to ${cap.label} inbox items are not supported yet.` },
    };
  }

  try {
    const founder = await deps.resolveFounderUser();
    if (!founder) {
      return {
        status: 422,
        body: { error: "No founder account resolved — cannot reply." },
      };
    }

    const token = await deps.getFounderToken(founder.id, platform);
    if (!("accessToken" in token)) {
      return {
        status: 422,
        body: { error: token.message, reason: token.reason },
      };
    }

    let result: InboxReplyResult;
    if (platform === "youtube") {
      result = await deps.replyToYouTubeComment(token.accessToken, parsed.data.itemId, text);
    } else if (platform === "facebook") {
      result = await deps.replyToFacebookComment(token.accessToken, parsed.data.itemId, text);
    } else if (platform === "instagram") {
      result = await deps.replyToInstagramComment(token.accessToken, parsed.data.itemId, text);
    } else {
      // A platform is capability-flagged replySupported but has no concrete
      // handler wired up — surface it honestly rather than pretending success.
      return {
        status: 422,
        body: { error: `Replies to ${cap.label} inbox items are not supported yet.` },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        platform,
        itemId: parsed.data.itemId,
        replyId: result.replyId,
        text: result.text,
        publishedAt: result.publishedAt,
      },
    };
  } catch (err) {
    deps.logError?.(err, platform);
    return {
      status: 502,
      body: {
        error: `Failed to post reply to ${cap.label}. The connected account may lack comment permissions — reconnect to grant them.`,
      },
    };
  }
}
