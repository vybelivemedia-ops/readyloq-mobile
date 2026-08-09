import type { Ionicons } from "@expo/vector-icons";
import * as MailComposer from "expo-mail-composer";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

/**
 * Extensible report-delivery registry.
 *
 * Each delivery method declares its own availability (device capability,
 * platform, installed apps) and how it delivers an already-generated PDF.
 * New channels — SMS, cloud drives, CRM push, a customer portal — register
 * themselves here without touching the summary screen, which simply renders
 * whatever the registry offers.
 */
export interface DeliveryContext {
  /** file:// URI of the generated PDF report. */
  pdfUri: string;
  /** Suggested subject line, e.g. "Inspection report — 12 Oak St". */
  subject: string;
  /** Plain-text body for channels that carry a message (email). */
  body: string;
  /** Optional approved customer-summary link (manager-gated upstream). */
  customerSummaryUrl: string | null;
}

export interface DeliveryMethod {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Cheap capability probe — hides the button when unavailable. */
  isAvailable: () => Promise<boolean>;
  /**
   * Hands the report off to the channel. Resolves when the hand-off UI has
   * been dismissed; throws only on genuine failure (surfaced to the user).
   */
  deliver: (ctx: DeliveryContext) => Promise<void>;
  /**
   * When true the sync engine may call `deliver` automatically on reconnection
   * (server-push channels: SMS gateway, CRM webhook, portal push, etc.).
   * Interactive OS-sheet channels (email, share, print) MUST leave this unset
   * or false — the OS cannot open a dialog in the background.
   */
  supportsAutoRetry?: boolean;
}

const methods: DeliveryMethod[] = [];

export function registerDeliveryMethod(method: DeliveryMethod): void {
  const existing = methods.findIndex((m) => m.id === method.id);
  if (existing >= 0) methods.splice(existing, 1, method);
  else methods.push(method);
}

/** Look up a registered method by id (returns undefined when not found). */
export function getDeliveryMethod(id: string): DeliveryMethod | undefined {
  return methods.find((m) => m.id === id);
}

/** Resolves the registered methods that are usable on this device, in order. */
export async function getAvailableDeliveryMethods(): Promise<DeliveryMethod[]> {
  const checks = await Promise.all(
    methods.map(async (m) => {
      // Native-module probes can throw on binaries built before the module
      // was added — treat that as "not available", never as a crash.
      try {
        return (await m.isAvailable()) ? m : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((m): m is DeliveryMethod => m !== null);
}

// ─── Built-in channels ───────────────────────────────────────────────────────

registerDeliveryMethod({
  id: "print",
  label: "Print",
  icon: "print-outline",
  isAvailable: async () => true, // OS print dialog handles printer discovery.
  deliver: async ({ pdfUri }) => {
    await Print.printAsync({ uri: pdfUri });
  },
});

registerDeliveryMethod({
  id: "share",
  label: "Share PDF",
  icon: "share-outline",
  isAvailable: () => Sharing.isAvailableAsync(),
  deliver: async ({ pdfUri }) => {
    await Sharing.shareAsync(pdfUri, {
      mimeType: "application/pdf",
      dialogTitle: "Share inspection report",
      UTI: "com.adobe.pdf",
    });
  },
});

registerDeliveryMethod({
  id: "email",
  label: "Email report",
  icon: "mail-outline",
  isAvailable: () => MailComposer.isAvailableAsync(),
  deliver: async ({ pdfUri, subject, body, customerSummaryUrl }) => {
    const fullBody = customerSummaryUrl
      ? `${body}\n\nView your customer summary online:\n${customerSummaryUrl}`
      : body;
    const result = await MailComposer.composeAsync({
      subject,
      body: fullBody,
      attachments: [pdfUri],
    });
    if (result.status === undefined) {
      throw new Error("Email could not be opened on this device.");
    }
  },
});

/**
 * Preview — generates the PDF and opens it in the system document viewer
 * (iOS Quick Look sheet, Android PDF viewer) so the technician can confirm
 * the content before choosing a delivery channel. Registered first in the
 * list so it renders to the left of the outbound delivery buttons.
 *
 * Intentionally registered after the other methods so it can be inserted
 * at position 0 in the list — callers that want to show preview first
 * can sort/shift by id === "preview".
 */
registerDeliveryMethod({
  id: "preview",
  label: "Preview PDF",
  icon: "eye-outline",
  isAvailable: () => Sharing.isAvailableAsync(),
  deliver: async ({ pdfUri }) => {
    // Opening with the PDF mime-type causes iOS to display the file in the
    // Quick Look sheet (a full in-app document viewer) before presenting the
    // share sheet. On Android the OS routes to the installed PDF viewer app.
    await Sharing.shareAsync(pdfUri, {
      mimeType: "application/pdf",
      dialogTitle: "Preview inspection report",
      UTI: "com.adobe.pdf",
    });
  },
});
