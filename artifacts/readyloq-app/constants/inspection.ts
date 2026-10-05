import type { BadgeTone } from "@/components/ui/Badge";

export const PROPERTY_TYPES = [
  "Residential",
  "Commercial",
  "Restaurant",
  "Multi-Family",
  "Warehouse",
  "School",
  "Healthcare",
  "Hospitality",
] as const;

/**
 * Freeform reason for the visit, offered as quick-pick chips at booking time.
 * Stored as plain text (not a strict enum) so a future enterprise-routing
 * import can also populate it from a legacy "stop type" field.
 */
export const VISIT_PURPOSES = [
  "Routine Inspection",
  "Initial Service",
  "Callback",
  "Follow-up",
  "Other",
] as const;

export const PEST_TYPES = [
  "Rodents",
  "Cockroaches",
  "Termites",
  "Ants",
  "Bed Bugs",
  "Stored Product Pests",
  "Flies",
  "Spiders",
  "Wildlife",
] as const;

export const INSPECTION_ZONES = [
  "Kitchen",
  "Exterior Perimeter",
  "Storage / Dry Goods",
  "Basement / Crawlspace",
  "Attic",
  "Restrooms",
  "Receiving / Dock",
  "Mechanical Room",
] as const;

export function statusTone(status?: string | null): BadgeTone {
  switch ((status || "").toLowerCase()) {
    case "completed":
    case "complete":
      return "success";
    case "in_progress":
    case "in-progress":
    case "analyzing":
      return "info";
    case "draft":
    case "open":
    case "pending":
      return "warning";
    default:
      return "default";
  }
}

export function severityTone(severity?: string | null): BadgeTone {
  switch ((severity || "").toLowerCase()) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
    case "moderate":
      return "warning";
    case "low":
      return "success";
    default:
      return "default";
  }
}

export function formatStatus(status?: string | null): string {
  if (!status) return "Unknown";
  return status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Date + time, e.g. "Aug 16, 2026, 2:34 PM" */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export function confidencePct(confidence?: number | null): string {
  if (confidence == null) return "—";
  const pct = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(pct)}%`;
}
