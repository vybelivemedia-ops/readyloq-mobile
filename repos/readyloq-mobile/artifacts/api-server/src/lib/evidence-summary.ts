import type {
  EvidenceCount,
  EvidenceGroup,
  EvidenceSummary,
  Finding,
  VideoEvidence,
} from "@workspace/db";

/**
 * Real-time evidence tally for the live AI Inspection Engine.
 *
 * Every number is aggregated straight from the vision model's per-photo
 * detections on REAL findings — nothing is inferred. It is DERIVED ON READ
 * (see `serializeResult`) from the analysis row's own `findings` +
 * `videoEvidence`, so it needs no persisted column and can never go stale.
 *
 * Grouping rules (a finding may qualify for several groups — a single photo can
 * show a pest AND moisture AND an entry point):
 *   - pests       → grouped by `species` (case-insensitive, first casing kept)
 *   - structural  → grouped by `structuralIssue`
 *   - moisture    → grouped by `moisture` descriptor
 *   - exclusion   → count of findings flagged `exclusionOpportunity`
 *
 * `total` on each group is the count of findings carrying that attribute and is
 * the PRIMARY display number ("3 Moisture"). `items` is a per-label breakdown —
 * genuinely useful for pest species; for structural / moisture the free text is
 * usually all-unique, so treat items as secondary detail. Group totals are
 * independent and MUST NOT be summed to reach `totalEvidence`.
 */

/**
 * Case-insensitive count of non-empty label strings. Returns the running total
 * (findings that had a value) plus a per-label breakdown, sorted by count desc
 * then label. Defensive against non-string / missing values because the POST
 * /analysis body and merged technician findings can carry malformed fields.
 */
function tallyLabels(values: (string | null | undefined)[]): {
  total: number;
  items: EvidenceCount[];
} {
  const map = new Map<string, { label: string; count: number }>();
  let total = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    total += 1;
    const key = trimmed.toLowerCase();
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { label: trimmed, count: 1 });
  }
  const items: EvidenceCount[] = [...map.entries()]
    .map(([key, { label, count }]) => ({ key, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total, items };
}

export function computeEvidenceSummary(
  findings: readonly Finding[] | null | undefined,
  videoEvidence?: readonly VideoEvidence[] | null,
): EvidenceSummary {
  const list = Array.isArray(findings) ? findings : [];
  const videoCount = Array.isArray(videoEvidence) ? videoEvidence.length : 0;

  const pests = tallyLabels(list.map((f) => f?.species));
  const structural = tallyLabels(list.map((f) => f?.structuralIssue));
  const moisture = tallyLabels(list.map((f) => f?.moisture));
  const exclusionCount = list.filter((f) => f?.exclusionOpportunity === true).length;

  const groups: EvidenceGroup[] = [];
  if (pests.total > 0) {
    groups.push({ key: "pests", label: "Pest detections", total: pests.total, items: pests.items });
  }
  if (structural.total > 0) {
    groups.push({
      key: "structural",
      label: "Structural defects",
      total: structural.total,
      items: structural.items,
    });
  }
  if (moisture.total > 0) {
    groups.push({ key: "moisture", label: "Moisture", total: moisture.total, items: moisture.items });
  }
  if (exclusionCount > 0) {
    groups.push({
      key: "exclusion",
      label: "Exclusion opportunities",
      total: exclusionCount,
      items: [{ key: "exclusion", label: "Exclusion opportunity", count: exclusionCount }],
    });
  }

  const photoEvidence = list.length;
  return {
    totalEvidence: photoEvidence + videoCount,
    photoEvidence,
    videoEvidence: videoCount,
    groups,
  };
}
