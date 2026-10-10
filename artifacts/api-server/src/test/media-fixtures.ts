import { randomUUID } from "node:crypto";
import { db, usersTable, inspectionsTable, inspectionUploadIntentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Real database reservations for HTTP tests; only storage IO is mocked. */
export async function reserveTestMedia(
  inspectionId: number, clerkUserId: string, mediaType: string, url: string,
): Promise<number> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
  if (!user || !inspection || user.companyId !== inspection.companyId) {
    throw new Error("Media fixture requires an authenticated, same-company parent");
  }
  const objectPath = url.replace(/^\/api\/storage/, "");
  if (!objectPath.startsWith(`/objects/companies/${user.companyId}/uploads/`)) {
    throw new Error("Media fixture path must belong to its authenticated company");
  }
  const [existing] = await db.select().from(inspectionUploadIntentsTable)
    .where(eq(inspectionUploadIntentsTable.objectPath, objectPath));
  if (existing) {
    if (existing.userId !== user.id || existing.inspectionId !== inspectionId) {
      throw new Error("Media fixture reservation collided across users or inspections");
    }
    return existing.id;
  }
  const [intent] = await db.insert(inspectionUploadIntentsTable).values({
    userId: user.id, companyId: inspection.companyId, inspectionId,
    clientKey: randomUUID(), mediaType,
    contentType: mediaType === "video" ? (url.endsWith(".mp4") ? "video/mp4" : "video/webm") : "image/jpeg",
    expectedSize: 123, objectPath,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  }).returning();
  return intent.id;
}

/** Model an uploaded object's metadata for an explicitly seeded reservation. */
export async function testMediaMetadata(objectPath: string) {
  const [intent] = await db.select().from(inspectionUploadIntentsTable)
    .where(eq(inspectionUploadIntentsTable.objectPath, objectPath));
  if (!intent) throw new Error("No uploaded-object fixture for this path");
  return { size: intent.expectedSize, contentType: intent.contentType, md5Hash: null };
}
