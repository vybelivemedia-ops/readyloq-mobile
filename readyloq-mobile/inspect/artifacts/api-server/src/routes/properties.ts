import { Router } from "express";
import { db } from "@workspace/db";
import {
  inspectionsTable,
  inspectionMediaTable,
  analysisResultsTable,
  propertyProfilesTable,
  propertyNotesTable,
  type Finding,
  type Hotspot,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  normalizeAddressKey,
  propertyTypeFor,
  deriveRecurringIssues,
} from "../lib/property-intelligence";
import { getCompanyId } from "../lib/tenant";

const router = Router();

type InspectionRow = typeof inspectionsTable.$inferSelect;

const hotspotSchema = z.object({
  zone: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
});

const profileUpdateSchema = z.object({
  siteAddress: z.string().min(1).optional(),
  clientName: z.string().optional(),
  propertyType: z.string().optional(),
  technicianKnowledge: z.string().optional(),
  hotspots: z.array(hotspotSchema).optional(),
});

const noteInputSchema = z.object({
  note: z.string().min(1),
  zone: z.string().optional(),
  category: z.string().optional(),
  authorName: z.string().optional(),
});

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

const byNewest = (a: { createdAt: Date | string }, b: { createdAt: Date | string }) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

// Lightweight fuzzy match for "possible" pre-inspection matches: shared prefix
// or >= 50% token (Jaccard) overlap on the normalized slug.
function addressesSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const ta = new Set(a.split("-").filter(Boolean));
  const tb = new Set(b.split("-").filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.5;
}

// Build the per-property summaries used by GET / and GET /lookup.
async function buildSummaries(companyId: number) {
  const [allInspections, profiles, allNotes, allAnalyses] = await Promise.all([
    db.select().from(inspectionsTable).where(eq(inspectionsTable.companyId, companyId)),
    db
      .select()
      .from(propertyProfilesTable)
      .where(eq(propertyProfilesTable.companyId, companyId)),
    db.select().from(propertyNotesTable).where(eq(propertyNotesTable.companyId, companyId)),
    db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId)),
  ]);

  const groups = new Map<string, InspectionRow[]>();
  const keyByInspection = new Map<number, string>();
  for (const insp of allInspections) {
    const key = normalizeAddressKey(insp.siteAddress);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(insp);
    groups.set(key, arr);
    keyByInspection.set(insp.id, key);
  }

  const profileByKey = new Map(profiles.map((p) => [p.addressKey, p]));

  const noteCountByKey = new Map<string, number>();
  for (const n of allNotes)
    noteCountByKey.set(n.addressKey, (noteCountByKey.get(n.addressKey) ?? 0) + 1);

  const categoriesByKey = new Map<string, Set<string>>();
  for (const a of allAnalyses) {
    const key = keyByInspection.get(a.inspectionId);
    if (!key) continue;
    const set = categoriesByKey.get(key) ?? new Set<string>();
    for (const f of (a.findings ?? []) as Finding[]) set.add(f.category || "Observation");
    categoriesByKey.set(key, set);
  }

  const allKeys = new Set<string>([...groups.keys(), ...profileByKey.keys()]);

  return Array.from(allKeys)
    .map((key) => {
      const insps = (groups.get(key) ?? []).slice().sort(byNewest);
      const profile = profileByKey.get(key);
      const mostRecent = insps[0];
      const siteAddress = profile?.siteAddress ?? mostRecent?.siteAddress ?? key;
      const clientName = profile?.clientName ?? mostRecent?.clientName ?? null;
      const propertyType = profile?.propertyType ?? propertyTypeFor(clientName, siteAddress);
      const lastVisit = mostRecent ? iso(mostRecent.createdAt) : iso(profile?.updatedAt);
      return {
        addressKey: key,
        siteAddress,
        clientName,
        propertyType,
        inspectionCount: insps.length,
        hotspotCount: (profile?.hotspots ?? []).length,
        noteCount: noteCountByKey.get(key) ?? 0,
        openIssueCount: categoriesByKey.get(key)?.size ?? 0,
        lastVisit,
        hasProfile: !!profile,
      };
    })
    .sort((a, b) => (b.lastVisit ?? "").localeCompare(a.lastVisit ?? ""));
}

// Build the full intelligence feed for one normalized addressKey.
async function buildFeed(addressKey: string, companyId: number) {
  const [profileRows, allInspections, notes] = await Promise.all([
    db
      .select()
      .from(propertyProfilesTable)
      .where(
        and(
          eq(propertyProfilesTable.companyId, companyId),
          eq(propertyProfilesTable.addressKey, addressKey),
        ),
      ),
    db.select().from(inspectionsTable).where(eq(inspectionsTable.companyId, companyId)),
    db
      .select()
      .from(propertyNotesTable)
      .where(
        and(
          eq(propertyNotesTable.companyId, companyId),
          eq(propertyNotesTable.addressKey, addressKey),
        ),
      )
      .orderBy(desc(propertyNotesTable.createdAt)),
  ]);
  const profile = profileRows[0];

  const matched = allInspections
    .filter((i) => normalizeAddressKey(i.siteAddress) === addressKey)
    .sort(byNewest);
  const ids = matched.map((i) => i.id);

  let analyses: (typeof analysisResultsTable.$inferSelect)[] = [];
  let media: (typeof inspectionMediaTable.$inferSelect)[] = [];
  if (ids.length > 0) {
    [analyses, media] = await Promise.all([
      db
        .select()
        .from(analysisResultsTable)
        .where(
          and(
            eq(analysisResultsTable.companyId, companyId),
            inArray(analysisResultsTable.inspectionId, ids),
          ),
        ),
      db
        .select()
        .from(inspectionMediaTable)
        .where(
          and(
            eq(inspectionMediaTable.companyId, companyId),
            inArray(inspectionMediaTable.inspectionId, ids),
          ),
        ),
    ]);
  }

  const inspById = new Map(matched.map((i) => [i.id, i]));

  const recurringIssues = deriveRecurringIssues(
    analyses.map((a) => ({
      findings: (a.findings ?? []) as Finding[],
      date: inspById.get(a.inspectionId)?.createdAt ?? a.createdAt,
    })),
  );

  const historicalPhotos = media
    .filter((m) => m.mediaType === "photo")
    .sort(byNewest)
    .map((m) => ({
      url: m.url,
      caption: m.caption ?? null,
      inspectionId: m.inspectionId,
      createdAt: iso(m.createdAt),
    }));

  const visitHistory = matched.map((i) => ({
    inspectionId: i.id,
    createdAt: iso(i.createdAt) as string,
    status: i.status,
    technicianName: i.technicianName ?? null,
    severity: i.severity ?? null,
    findingsCount: i.findingsCount ?? 0,
    completedAt: iso(i.completedAt),
  }));

  const mostRecent = matched[0];
  const siteAddress = profile?.siteAddress ?? mostRecent?.siteAddress ?? addressKey;
  const clientName = profile?.clientName ?? mostRecent?.clientName ?? null;
  const propertyType = profile?.propertyType ?? propertyTypeFor(clientName, siteAddress);

  return {
    addressKey,
    siteAddress,
    clientName,
    propertyType,
    technicianKnowledge: profile?.technicianKnowledge ?? null,
    hasProfile: !!profile,
    updatedAt: iso(profile?.updatedAt),
    hotspots: (profile?.hotspots ?? []) as Hotspot[],
    recurringIssues,
    historicalPhotos,
    visitHistory,
    notes: notes.map((n) => ({ ...n, createdAt: iso(n.createdAt) as string })),
  };
}

// GET /properties — list known properties with intelligence summary
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    return res.json(await buildSummaries(companyId));
  } catch {
    return res.status(500).json({ error: "Failed to list properties" });
  }
});

// GET /properties/lookup?siteAddress=... — pre-inspection lookup
router.get("/lookup", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const siteAddress = typeof req.query.siteAddress === "string" ? req.query.siteAddress : "";
    if (!siteAddress.trim()) {
      return res.json({ matchStatus: "none", suggestions: [] });
    }
    const key = normalizeAddressKey(siteAddress);
    const summaries = await buildSummaries(companyId);

    const exact = summaries.find((s) => s.addressKey === key);
    if (exact) {
      const feed = await buildFeed(key, companyId);
      return res.json({ matchStatus: "exact", feed, suggestions: [] });
    }

    const possible = summaries.filter((s) => addressesSimilar(key, s.addressKey)).slice(0, 5);
    return res.json({
      matchStatus: possible.length > 0 ? "possible" : "none",
      suggestions: possible,
    });
  } catch {
    return res.status(500).json({ error: "Failed to look up property" });
  }
});

// GET /properties/:addressKey — full intelligence feed
router.get("/:addressKey", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const key = normalizeAddressKey(decodeURIComponent(req.params.addressKey));
    if (!key) return res.status(400).json({ error: "Invalid address key" });
    return res.json(await buildFeed(key, companyId));
  } catch {
    return res.status(500).json({ error: "Failed to load property feed" });
  }
});

// PATCH /properties/:addressKey — create/update authored intelligence
router.patch("/:addressKey", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const key = normalizeAddressKey(decodeURIComponent(req.params.addressKey));
    if (!key) return res.status(400).json({ error: "Invalid address key" });

    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
    }

    // Guard the core invariant: a profile's siteAddress must always normalize to
    // its addressKey, or future address lookups would silently miss the profile.
    if (parsed.data.siteAddress && normalizeAddressKey(parsed.data.siteAddress) !== key) {
      return res
        .status(400)
        .json({ error: "siteAddress does not match the address key for this property" });
    }

    const [existing] = await db
      .select()
      .from(propertyProfilesTable)
      .where(
        and(
          eq(propertyProfilesTable.companyId, companyId),
          eq(propertyProfilesTable.addressKey, key),
        ),
      );

    let siteAddress: string | undefined = parsed.data.siteAddress ?? existing?.siteAddress;
    if (!siteAddress) {
      const allInspections = await db
        .select()
        .from(inspectionsTable)
        .where(eq(inspectionsTable.companyId, companyId));
      siteAddress = allInspections.find((i) => normalizeAddressKey(i.siteAddress) === key)
        ?.siteAddress;
    }
    if (!siteAddress) {
      return res.status(400).json({ error: "siteAddress is required to create a property profile" });
    }

    if (existing) {
      await db
        .update(propertyProfilesTable)
        .set({
          siteAddress,
          clientName: parsed.data.clientName ?? existing.clientName,
          propertyType: parsed.data.propertyType ?? existing.propertyType,
          technicianKnowledge: parsed.data.technicianKnowledge ?? existing.technicianKnowledge,
          hotspots: parsed.data.hotspots ?? existing.hotspots,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(propertyProfilesTable.companyId, companyId),
            eq(propertyProfilesTable.addressKey, key),
          ),
        );
    } else {
      await db.insert(propertyProfilesTable).values({
        companyId,
        addressKey: key,
        siteAddress,
        clientName: parsed.data.clientName ?? null,
        propertyType:
          parsed.data.propertyType ??
          propertyTypeFor(parsed.data.clientName ?? null, siteAddress),
        technicianKnowledge: parsed.data.technicianKnowledge ?? null,
        hotspots: parsed.data.hotspots ?? [],
      });
    }

    return res.json(await buildFeed(key, companyId));
  } catch {
    return res.status(500).json({ error: "Failed to update property profile" });
  }
});

// POST /properties/:addressKey/notes — append a field note
router.post("/:addressKey/notes", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const key = normalizeAddressKey(decodeURIComponent(req.params.addressKey));
    if (!key) return res.status(400).json({ error: "Invalid address key" });

    const parsed = noteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
    }

    const [row] = await db
      .insert(propertyNotesTable)
      .values({
        companyId,
        addressKey: key,
        note: parsed.data.note,
        zone: parsed.data.zone ?? null,
        category: parsed.data.category ?? null,
        authorName: parsed.data.authorName ?? null,
      })
      .returning();

    return res.status(201).json({ ...row, createdAt: iso(row.createdAt) as string });
  } catch {
    return res.status(500).json({ error: "Failed to add property note" });
  }
});

export default router;
