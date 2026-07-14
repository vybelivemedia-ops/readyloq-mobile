// ─── V11.1: Connector Detection Registry ─────────────────────────────────────
// "Connected" blockers are resolvable by an external provider Mission Control is
// already wired to (GitHub, Replit, Stripe, Meta, Agora, Google, Email, …). This
// registry is the single source of truth for (a) which providers exist, (b) the
// keywords that route a blocker to a provider, and (c) whether that provider is
// currently available (credentials present / integration connected).
//
// Availability is detected from the environment (secret presence) and, for
// GitHub, from the latest engineering snapshot's provider diagnostics. Detection
// is best-effort and must never throw into a resolution pass.

import type { ProviderDiagnostic } from "../engineering/types.js";

export type ConnectorProvider =
  | "github"
  | "replit"
  | "stripe"
  | "meta"
  | "agora"
  | "google"
  | "email"
  | "google_play"
  | "firebase"
  | "analytics";

export interface ConnectorStatus {
  provider: ConnectorProvider;
  label: string;
  available: boolean;
  reason: string;
}

export interface ConnectorDetectContext {
  env: NodeJS.ProcessEnv;
  // Provider diagnostics from the latest flagship engineering snapshot — used to
  // confirm the GitHub integration is actually reporting in (not just installed).
  engineeringProviders: ProviderDiagnostic[];
}

interface ConnectorDefinition {
  provider: ConnectorProvider;
  label: string;
  // Lowercased substrings that route a blocker's text to this provider.
  keywords: string[];
  detect: (ctx: ConnectorDetectContext) => { available: boolean; reason: string };
}

function hasEnv(env: NodeJS.ProcessEnv, ...keys: string[]): boolean {
  return keys.every((k) => typeof env[k] === "string" && env[k]!.trim().length > 0);
}

export const CONNECTOR_REGISTRY: ConnectorDefinition[] = [
  {
    provider: "github",
    label: "GitHub",
    keywords: [
      "github",
      "git ",
      "pull request",
      " pr ",
      "merge",
      "branch",
      "commit",
      "repository",
      "repo",
      "ci",
      "pipeline",
      "workflow run",
    ],
    detect: (ctx) => {
      const provider = ctx.engineeringProviders.find((p) =>
        p.name.toLowerCase().includes("github"),
      );
      if (provider) {
        const ok = provider.status === "connected" || provider.status === "degraded";
        return {
          available: ok,
          reason: ok
            ? "GitHub integration is connected and reporting in the latest snapshot."
            : `GitHub provider status is "${provider.status}".`,
        };
      }
      // The integration is installed at the platform level even when a snapshot
      // hasn't captured it yet.
      return {
        available: true,
        reason: "GitHub integration is installed at the platform level.",
      };
    },
  },
  {
    provider: "replit",
    label: "Replit",
    keywords: [
      "replit",
      "deployment",
      "deploy",
      "publish",
      "workflow",
      "secret",
      "environment variable",
      "env var",
      "database",
      "object storage",
      "hosting",
    ],
    detect: () => ({
      available: true,
      reason: "Running on Replit — deployments, workflows, secrets and storage are always reachable.",
    }),
  },
  {
    provider: "stripe",
    label: "Stripe",
    keywords: ["stripe", "subscription", "billing", "invoice", "checkout", "webhook", "payout"],
    detect: (ctx) => {
      const ok = hasEnv(ctx.env, "STRIPE_SECRET_KEY");
      return {
        available: ok,
        reason: ok
          ? "Stripe secret key is configured."
          : "Stripe is not connected (STRIPE_SECRET_KEY missing).",
      };
    },
  },
  {
    provider: "meta",
    label: "Meta",
    keywords: ["meta", "facebook", "instagram", "whatsapp", "threads"],
    detect: (ctx) => {
      const ok = hasEnv(ctx.env, "META_APP_ID", "META_APP_SECRET");
      return {
        available: ok,
        reason: ok
          ? "Meta app credentials are configured."
          : "Meta is not connected (META_APP_ID / META_APP_SECRET missing).",
      };
    },
  },
  {
    provider: "agora",
    label: "Agora",
    keywords: ["agora", "rtmp", "rtc", "ingest", "stream key", "media push", "cloud recording"],
    detect: (ctx) => {
      const ok = hasEnv(ctx.env, "AGORA_CUSTOMER_ID", "AGORA_CUSTOMER_SECRET");
      return {
        available: ok,
        reason: ok
          ? "Agora customer credentials are configured."
          : "Agora is not connected (AGORA_CUSTOMER_ID / AGORA_CUSTOMER_SECRET missing).",
      };
    },
  },
  {
    provider: "google",
    label: "Google",
    keywords: ["google", "oauth", "youtube", "gmail oauth", "google sign"],
    detect: (ctx) => {
      const ok = hasEnv(ctx.env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
      return {
        available: ok,
        reason: ok
          ? "Google OAuth credentials are configured."
          : "Google is not connected (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).",
      };
    },
  },
  {
    provider: "email",
    label: "Email (SMTP)",
    keywords: ["email", "smtp", "transactional mail", "send mail", "notification email"],
    detect: (ctx) => {
      const ok = hasEnv(ctx.env, "SMTP_USER", "SMTP_PASS");
      return {
        available: ok,
        reason: ok
          ? "SMTP credentials are configured."
          : "Email is not connected (SMTP_USER / SMTP_PASS missing).",
      };
    },
  },
  {
    provider: "google_play",
    label: "Google Play",
    keywords: ["google play", "play store", "play console", "android release", "aab"],
    detect: () => ({
      available: false,
      reason: "Google Play Console is not connected — a service account must be linked by the account owner.",
    }),
  },
  {
    provider: "firebase",
    label: "Firebase",
    keywords: ["firebase", "fcm", "push notification", "remote config", "crashlytics"],
    detect: () => ({
      available: false,
      reason: "Firebase is not connected — no Firebase credentials are configured.",
    }),
  },
  {
    provider: "analytics",
    label: "Analytics",
    keywords: ["analytics", "amplitude", "mixpanel", "ga4", "google analytics", "telemetry pipeline"],
    detect: () => ({
      available: false,
      reason: "No analytics provider is connected.",
    }),
  },
];

const REGISTRY_BY_PROVIDER = new Map(CONNECTOR_REGISTRY.map((c) => [c.provider, c]));

/** Detect the availability of every known connector for the current context. */
export function detectConnectors(ctx: ConnectorDetectContext): Record<ConnectorProvider, ConnectorStatus> {
  const out = {} as Record<ConnectorProvider, ConnectorStatus>;
  for (const def of CONNECTOR_REGISTRY) {
    let result: { available: boolean; reason: string };
    try {
      result = def.detect(ctx);
    } catch {
      result = { available: false, reason: "Detection failed." };
    }
    out[def.provider] = {
      provider: def.provider,
      label: def.label,
      available: result.available,
      reason: result.reason,
    };
  }
  return out;
}

/**
 * Route a blocker's text to the connector whose keywords it matches, if any.
 * Returns the provider and its display label regardless of availability — the
 * caller decides what to do when the matched connector is unavailable.
 */
export function matchConnector(text: string): { provider: ConnectorProvider; label: string } | null {
  const haystack = ` ${text.toLowerCase()} `;
  for (const def of CONNECTOR_REGISTRY) {
    if (def.keywords.some((kw) => haystack.includes(kw))) {
      return { provider: def.provider, label: def.label };
    }
  }
  return null;
}

export function connectorLabel(provider: ConnectorProvider): string {
  return REGISTRY_BY_PROVIDER.get(provider)?.label ?? provider;
}
