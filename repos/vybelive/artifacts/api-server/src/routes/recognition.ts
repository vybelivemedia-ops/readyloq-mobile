import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  recognitionSettingsTable,
  DEFAULT_TRIGGER_PHRASES,
  DEFAULT_ENABLED_GESTURES,
} from "@workspace/db";
import { UpdateRecognitionSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router = Router();

type RecognitionSettingsRow = typeof recognitionSettingsTable.$inferSelect;

function toResponse(row: RecognitionSettingsRow) {
  return {
    voiceEnabled: row.voiceEnabled,
    gestureEnabled: row.gestureEnabled,
    triggerPhrases: row.triggerPhrases,
    enabledGestures: row.enabledGestures,
    sensitivity: row.sensitivity,
    contextWindowSeconds: row.contextWindowSeconds,
  };
}

// Load the caller's settings row, creating it with defaults on first access.
async function loadOrCreateSettings(userId: string): Promise<RecognitionSettingsRow> {
  const [existing] = await db
    .select()
    .from(recognitionSettingsTable)
    .where(eq(recognitionSettingsTable.userId, userId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(recognitionSettingsTable)
    .values({
      userId,
      triggerPhrases: DEFAULT_TRIGGER_PHRASES,
      enabledGestures: DEFAULT_ENABLED_GESTURES,
    })
    .onConflictDoNothing()
    .returning();

  // If a concurrent request created the row first, onConflictDoNothing returns
  // nothing — re-read so we always return a real row.
  if (created) return created;
  const [row] = await db
    .select()
    .from(recognitionSettingsTable)
    .where(eq(recognitionSettingsTable.userId, userId))
    .limit(1);
  return row!;
}

// GET /api/recognition-settings
router.get("/recognition-settings", requireAuth, async (req, res) => {
  const settings = await loadOrCreateSettings(req.auth!.userId);
  res.json(toResponse(settings));
});

// PATCH /api/recognition-settings
router.patch("/recognition-settings", requireAuth, async (req, res) => {
  const parsed = UpdateRecognitionSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Ensure a row exists before updating.
  await loadOrCreateSettings(req.auth!.userId);

  const updates: Partial<typeof recognitionSettingsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.voiceEnabled !== undefined) updates.voiceEnabled = parsed.data.voiceEnabled;
  if (parsed.data.gestureEnabled !== undefined) updates.gestureEnabled = parsed.data.gestureEnabled;
  if (parsed.data.triggerPhrases !== undefined) {
    // Trim, drop empties, de-dupe while preserving order.
    const seen = new Set<string>();
    updates.triggerPhrases = parsed.data.triggerPhrases
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  }
  if (parsed.data.enabledGestures !== undefined) {
    updates.enabledGestures = Array.from(new Set(parsed.data.enabledGestures));
  }
  if (parsed.data.sensitivity !== undefined) updates.sensitivity = parsed.data.sensitivity;
  if (parsed.data.contextWindowSeconds !== undefined) {
    updates.contextWindowSeconds = parsed.data.contextWindowSeconds;
  }

  const [updated] = await db
    .update(recognitionSettingsTable)
    .set(updates)
    .where(eq(recognitionSettingsTable.userId, req.auth!.userId))
    .returning();

  res.json(toResponse(updated!));
});

export default router;
