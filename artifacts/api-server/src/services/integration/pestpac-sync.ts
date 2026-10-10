import { createHash, randomUUID } from "node:crypto";
import {
  db,
  companyFieldIntegrationsTable,
  integrationConflictsTable,
  integrationEntityLinksTable,
  integrationSyncMessagesTable,
  integrationSyncRunsTable,
  inspectionsTable,
  productsTable,
  propertyProfilesTable,
  treatmentLogsTable,
  type EnterpriseSyncEntityType,
  type EnterpriseSyncMessageStatus,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { normalizeAddressKey } from "../../lib/property-intelligence";
import { ssrfSafeFetch } from "../../lib/ssrf-safe-fetch";
import { isSafeBaseUrl } from "../../lib/ssrf-guard";
import { logger } from "../../lib/logger";

const PROVIDER = "pestpac" as const;
const DEFAULT_BASE_URL = "https://api.pestpac.com/v1";
const INBOUND_RESOURCES = [
  { resource: "customers", entityType: "customer" as const, keys: ["customers"] },
  { resource: "locations", entityType: "location" as const, keys: ["locations", "properties"] },
  { resource: "routes", entityType: "route" as const, keys: ["routes"] },
  { resource: "workorders", entityType: "work_order" as const, keys: ["workOrders", "workorders"] },
] as const;
const MAX_MESSAGE_ATTEMPTS = 8;

export function isPestPacBidirectionalSyncEnabled(): boolean {
  return process.env.PESTPAC_BIDIRECTIONAL_SYNC_ENABLED === "true";
}

type PestPacEntityType = (typeof INBOUND_RESOURCES)[number]["entityType"];
type RawRecord = Record<string, unknown>;
type TransactionExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface NormalizedPestPacRecord {
  entityType: PestPacEntityType;
  externalId: string;
  externalParentId?: string;
  externalVersion?: string;
  sourceUpdatedAt?: string;
  payload: RawRecord;
}

export interface PestPacCustomer {
  id: string;
  displayName: string;
  notes: string | null;
}

export interface PestPacLocation {
  id: string;
  customerExternalId: string | null;
  siteAddress: string;
  displayName: string | null;
  propertyType: string | null;
  serviceNotes: string | null;
}

export interface PestPacWorkOrder {
  id: string;
  locationExternalId: string | null;
  customerExternalId: string | null;
  siteAddress: string;
  clientName: string | null;
  scheduledDate: string | null;
  technicianId: string | null;
  technicianName: string;
  visitPurpose: string | null;
  unitNumber: string | null;
  status: string | null;
}

export interface PestPacRoute {
  id: string;
  serviceDate: string | null;
  technicianId: string | null;
  technicianName: string;
  stopCount: number;
}

export class PestPacSyncError extends Error {
  constructor(
    message: string,
    public readonly classification:
      | "retryable"
      | "permanent"
      | "unauthorized"
      | "conflict",
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = "PestPacSyncError";
  }
}

type SyncFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type PestPacHistoryStatus =
  | "available"
  | "disabled"
  | "not_configured"
  | "not_mapped"
  | "unavailable";

export interface PestPacLegacyNote {
  id: string;
  note: string;
  category: string | null;
  authorName: string | null;
  createdAt: string | null;
}

export interface PestPacStopHistory {
  status: PestPacHistoryStatus;
  notes: PestPacLegacyNote[];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as RawRecord)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function firstString(record: RawRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value?.trim()) return value.trim();
  }
  return null;
}

function nestedRecord(record: RawRecord, keys: string[]): RawRecord | null {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as RawRecord;
    }
  }
  return null;
}

function extractAddress(record: RawRecord): string {
  const address = nestedRecord(record, ["address", "serviceAddress", "location"]);
  if (address) {
    const line = firstString(address, ["street", "street1", "address1", "line1"]);
    const line2 = firstString(address, ["street2", "address2", "line2"]);
    const city = firstString(address, ["city", "town"]);
    const state = firstString(address, ["state", "stateCode", "province"]);
    const postal = firstString(address, ["zip", "postalCode", "postal"]);
    return [line, line2, city, state, postal].filter(Boolean).join(", ");
  }
  return firstString(record, ["siteAddress", "serviceAddress", "address", "addressLine"]) ?? "";
}

function extractArray(payload: unknown, keys: readonly string[]): RawRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is RawRecord => !!item && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") return [];
  const object = payload as RawRecord;
  for (const key of keys) {
    if (Array.isArray(object[key])) {
      return object[key].filter(
        (item): item is RawRecord => !!item && typeof item === "object",
      );
    }
  }
  return [];
}

function normalizeRecord(
  entityType: PestPacEntityType,
  raw: RawRecord,
): NormalizedPestPacRecord | null {
  const idKeys: Record<PestPacEntityType, string[]> = {
    customer: ["id", "customerId"],
    location: ["id", "locationId", "propertyId"],
    route: ["id", "routeId"],
    work_order: ["id", "workOrderId", "workorderId"],
  };
  const externalId = firstString(raw, idKeys[entityType]);
  if (!externalId) return null;

  const externalParentId =
    firstString(raw, ["customerId", "customerID", "locationId", "propertyId"]) ?? undefined;
  const externalVersion =
    firstString(raw, ["version", "etag", "updatedAt", "lastModified", "modifiedAt"]) ?? undefined;

  return {
    entityType,
    externalId,
    ...(externalParentId && { externalParentId }),
    ...(externalVersion && { externalVersion }),
    ...(externalVersion && { sourceUpdatedAt: externalVersion }),
    payload: raw,
  };
}

export function normalizePestPacRecord(
  entityType: PestPacEntityType,
  raw: RawRecord,
): NormalizedPestPacRecord | null {
  return normalizeRecord(entityType, raw);
}

export function mapPestPacCustomer(raw: RawRecord): PestPacCustomer | null {
  const normalized = normalizeRecord("customer", raw);
  if (!normalized) return null;
  const firstName = firstString(raw, ["firstName", "givenName"]);
  const lastName = firstString(raw, ["lastName", "familyName"]);
  return {
    id: normalized.externalId,
    displayName:
      [firstName, lastName].filter(Boolean).join(" ") ||
      firstString(raw, ["companyName", "name", "displayName"]) ||
      "Unnamed customer",
    notes: firstString(raw, ["notes", "serviceNotes", "specialInstructions"]),
  };
}

export function mapPestPacLocation(raw: RawRecord): PestPacLocation | null {
  const normalized = normalizeRecord("location", raw);
  if (!normalized) return null;
  return {
    id: normalized.externalId,
    customerExternalId:
      firstString(raw, ["customerId", "customerID"]) ??
      firstString(nestedRecord(raw, ["customer"]) ?? {}, ["id", "customerId"]),
    siteAddress: extractAddress(raw),
    displayName: firstString(raw, ["name", "locationName", "propertyName"]),
    propertyType: firstString(raw, ["propertyType", "type"]),
    serviceNotes: firstString(raw, ["notes", "serviceNotes", "accessNotes"]),
  };
}

export function mapPestPacWorkOrder(raw: RawRecord): PestPacWorkOrder | null {
  const normalized = normalizeRecord("work_order", raw);
  if (!normalized) return null;
  const technician = nestedRecord(raw, ["technician", "employee", "assignedTo"]) ?? {};
  return {
    id: normalized.externalId,
    locationExternalId:
      firstString(raw, ["locationId", "propertyId"]) ??
      firstString(nestedRecord(raw, ["location", "property"]) ?? {}, ["id", "locationId"]),
    customerExternalId:
      firstString(raw, ["customerId", "customerID"]) ??
      firstString(nestedRecord(raw, ["customer"]) ?? {}, ["id", "customerId"]),
    siteAddress: extractAddress(raw),
    clientName:
      firstString(raw, ["customerName", "clientName"]) ??
      firstString(nestedRecord(raw, ["customer"]) ?? {}, ["name", "displayName"]),
    scheduledDate: firstString(raw, ["scheduledDate", "serviceDate", "startTime", "scheduledAt"]),
    technicianId:
      firstString(raw, ["technicianId", "employeeId", "assignedEmployeeId"]) ??
      firstString(technician, ["id", "employeeId"]),
    technicianName:
      firstString(raw, ["technicianName", "employeeName", "assignedToName"]) ??
      firstString(technician, ["name", "displayName"]) ??
      "Unassigned",
    visitPurpose: firstString(raw, ["visitPurpose", "serviceType", "workType", "description"]),
    unitNumber: firstString(raw, ["unitNumber", "unit", "apartment"]),
    status: firstString(raw, ["status", "workOrderStatus"]),
  };
}

export function mapPestPacRoute(raw: RawRecord): PestPacRoute | null {
  const normalized = normalizeRecord("route", raw);
  if (!normalized) return null;
  const stops = Array.isArray(raw.stops) ? raw.stops : [];
  const technician = nestedRecord(raw, ["technician", "employee", "assignedTo"]) ?? {};
  return {
    id: normalized.externalId,
    serviceDate: firstString(raw, ["serviceDate", "routeDate", "date"]),
    technicianId:
      firstString(raw, ["technicianId", "employeeId", "assignedEmployeeId"]) ??
      firstString(technician, ["id", "employeeId"]),
    technicianName:
      firstString(raw, ["technicianName", "employeeName"]) ??
      firstString(technician, ["name", "displayName"]) ??
      "Unassigned",
    stopCount: stops.length,
  };
}

function sourceVersion(record: NormalizedPestPacRecord): string {
  return record.externalVersion ?? hashPayload(record.payload);
}

export async function enqueuePestPacInboundRecord(
  companyId: number,
  record: NormalizedPestPacRecord,
): Promise<boolean> {
  const idempotencyKey = `inbound:${PROVIDER}:${record.entityType}:${record.externalId}:${sourceVersion(record)}`;
  const inserted = await db
    .insert(integrationSyncMessagesTable)
    .values({
      companyId,
      provider: PROVIDER,
      direction: "inbound",
      entityType: record.entityType,
      operation: "upsert",
      externalId: record.externalId,
      idempotencyKey,
      payloadJson: record.payload,
    })
    .onConflictDoNothing({
      target: [
        integrationSyncMessagesTable.companyId,
        integrationSyncMessagesTable.provider,
        integrationSyncMessagesTable.idempotencyKey,
      ],
    })
    .returning({ id: integrationSyncMessagesTable.id });
  return inserted.length > 0;
}

async function getPestPacConfig(companyId: number) {
  const [config] = await db
    .select()
    .from(companyFieldIntegrationsTable)
    .where(
      and(
        eq(companyFieldIntegrationsTable.companyId, companyId),
        eq(companyFieldIntegrationsTable.systemType, "pestpac"),
        eq(companyFieldIntegrationsTable.enabled, true),
      ),
    )
    .limit(1);
  return config ?? null;
}

function unavailablePestPacHistory(status: Exclude<PestPacHistoryStatus, "available">): PestPacStopHistory {
  return { status, notes: [] };
}

function normalizeLegacyNote(raw: RawRecord): PestPacLegacyNote | null {
  const note = firstString(raw, [
    "note",
    "text",
    "body",
    "description",
    "comments",
    "serviceNotes",
  ]);
  if (!note) return null;
  const author =
    nestedRecord(raw, ["author", "createdBy", "employee"]) ?? {};
  const createdAt = firstString(raw, [
    "createdAt",
    "createdDate",
    "noteDate",
    "serviceDate",
    "timestamp",
  ]);
  const parsedCreatedAt = validDate(createdAt);
  return {
    id:
      firstString(raw, ["id", "noteId", "serviceNoteId"]) ??
      createHash("sha256").update(stableStringify(raw)).digest("hex").slice(0, 24),
    note,
    category: firstString(raw, ["category", "noteType", "type"]),
    authorName:
      firstString(raw, ["authorName", "createdByName", "employeeName"]) ??
      firstString(author, ["name", "displayName"]),
    createdAt: parsedCreatedAt?.toISOString() ?? null,
  };
}

/**
 * Reads legacy notes for one ReadyLoq stop without accepting any external ID
 * or credential from the caller. The stop's company-scoped work-order link
 * resolves a company-scoped location link before the vendor is contacted.
 *
 * PestPac's production read contract is intentionally dormant behind the same
 * activation flag as inbound sync. For this REST contract, accountId is the
 * tenant-id and apiToken is the server-stored OAuth bearer access token.
 */
export async function getPestPacStopHistory(
  companyId: number,
  inspectionId: number,
  historyBefore: Date,
  options: { fetchImpl?: SyncFetch } = {},
): Promise<PestPacStopHistory> {
  if (!isPestPacBidirectionalSyncEnabled()) {
    return unavailablePestPacHistory("disabled");
  }

  const config = await getPestPacConfig(companyId);
  if (!config?.apiKey || !config.accountId || !config.apiToken) {
    return unavailablePestPacHistory("not_configured");
  }
  const baseUrl = config.apiBaseUrl ?? DEFAULT_BASE_URL;
  if (!isSafeBaseUrl(baseUrl)) {
    logger.warn(
      { companyId, inspectionId },
      "[pestpac-history] blocked unsafe configured base URL",
    );
    return unavailablePestPacHistory("unavailable");
  }

  const [workOrderLink] = await db
    .select({
      externalParentId: integrationEntityLinksTable.externalParentId,
      metadata: integrationEntityLinksTable.metadata,
    })
    .from(integrationEntityLinksTable)
    .where(
      and(
        eq(integrationEntityLinksTable.companyId, companyId),
        eq(integrationEntityLinksTable.provider, PROVIDER),
        eq(integrationEntityLinksTable.entityType, "work_order"),
        eq(integrationEntityLinksTable.localEntityId, inspectionId),
      ),
    )
    .limit(1);
  if (!workOrderLink) return unavailablePestPacHistory("not_mapped");

  const locationExternalId =
    mapPestPacWorkOrder(workOrderLink.metadata)?.locationExternalId ??
    workOrderLink.externalParentId;
  if (!locationExternalId) return unavailablePestPacHistory("not_mapped");

  const [locationLink] = await db
    .select({ externalId: integrationEntityLinksTable.externalId })
    .from(integrationEntityLinksTable)
    .where(
      and(
        eq(integrationEntityLinksTable.companyId, companyId),
        eq(integrationEntityLinksTable.provider, PROVIDER),
        eq(integrationEntityLinksTable.entityType, "location"),
        eq(integrationEntityLinksTable.externalId, locationExternalId),
      ),
    )
    .limit(1);
  if (!locationLink) return unavailablePestPacHistory("not_mapped");

  const fetchImpl = options.fetchImpl ?? ssrfSafeFetch;
  const url =
    `${baseUrl.replace(/\/$/, "")}/locations/` +
    `${encodeURIComponent(locationLink.externalId)}/notes`;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        apiKey: config.apiKey,
        "tenant-id": config.accountId,
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) {
      throw new PestPacSyncError(
        "PestPac rejected location-history credentials.",
        "unauthorized",
        "HISTORY_UNAUTHORIZED",
      );
    }
    if (response.status === 404) {
      throw new PestPacSyncError(
        "PestPac location-history endpoint was not found.",
        "permanent",
        "HISTORY_ENDPOINT_NOT_FOUND",
      );
    }
    if (!response.ok) {
      throw new PestPacSyncError(
        "PestPac location history is temporarily unavailable.",
        response.status >= 500 ? "retryable" : "permanent",
        response.status >= 500 ? "HISTORY_SERVER_ERROR" : "HISTORY_CLIENT_ERROR",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PestPacSyncError(
        "PestPac location history returned invalid JSON.",
        "retryable",
        "HISTORY_INVALID_JSON",
      );
    }

    const notes = extractArray(body, ["notes", "serviceNotes", "history"])
      .map(normalizeLegacyNote)
      .filter((note): note is PestPacLegacyNote => note !== null)
      .filter((note) => note.createdAt === null || new Date(note.createdAt) < historyBefore)
      .sort((a, b) => {
        if (a.createdAt === null) return 1;
        if (b.createdAt === null) return -1;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, 20);
    return { status: "available", notes };
  } catch (error) {
    logger.warn(
      {
        companyId,
        inspectionId,
        code: error instanceof PestPacSyncError ? error.errorCode : "HISTORY_FETCH_FAILED",
      },
      "[pestpac-history] legacy history fetch failed",
    );
    return unavailablePestPacHistory("unavailable");
  }
}

function appendCursors(
  url: string,
  syncCursor: string | null,
  pageCursor: string | null,
): string {
  const parsed = new URL(url);
  if (syncCursor) parsed.searchParams.set("modifiedSince", syncCursor);
  if (pageCursor) parsed.searchParams.set("cursor", pageCursor);
  parsed.searchParams.set("limit", "200");
  return parsed.toString();
}

async function fetchResource(
  baseUrl: string,
  resource: string,
  syncCursor: string | null,
  pageCursor: string | null,
  headers: Record<string, string>,
  fetchImpl: SyncFetch,
): Promise<{ records: RawRecord[]; nextCursor: string | null }> {
  const response = await fetchImpl(
    appendCursors(
      `${baseUrl.replace(/\/$/, "")}/${resource}`,
      syncCursor,
      pageCursor,
    ),
    {
      method: "GET",
      redirect: "error",
      headers,
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new PestPacSyncError(
      "PestPac rejected inbound synchronization credentials.",
      "unauthorized",
      "HTTP_UNAUTHORIZED",
    );
  }
  if (response.status === 404) {
    throw new PestPacSyncError(
      `PestPac endpoint /${resource} was not found; confirm the contract with Nate.`,
      "permanent",
      "ENDPOINT_NOT_FOUND",
    );
  }
  if (response.status >= 400 && response.status < 500) {
    throw new PestPacSyncError(
      `PestPac rejected /${resource} with HTTP ${response.status}.`,
      "permanent",
      "HTTP_CLIENT_ERROR",
    );
  }
  if (!response.ok) {
    throw new PestPacSyncError(
      `PestPac /${resource} returned HTTP ${response.status}.`,
      "retryable",
      "HTTP_SERVER_ERROR",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PestPacSyncError(
      `PestPac /${resource} returned invalid JSON.`,
      "retryable",
      "INVALID_JSON",
    );
  }
  const definition = INBOUND_RESOURCES.find((item) => item.resource === resource);
  let nextCursor: string | null = null;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const bodyRecord = body as RawRecord;
    nextCursor = firstString(bodyRecord, ["nextCursor", "nextPageToken"]);
    for (const key of ["meta", "pagination", "page"]) {
      if (nextCursor) break;
      const nested = bodyRecord[key];
      if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
        nextCursor = firstString(
          nested as RawRecord,
          ["nextCursor", "nextPageToken", "next"],
        );
      }
    }
  }
  return {
    records: extractArray(body, definition?.keys ?? []),
    nextCursor,
  };
}

export interface PollResult {
  runId: number;
  recordsSeen: number;
  recordsQueued: number;
  cursor: string;
}

export async function pollPestPacInbound(
  companyId: number,
  options: { fetchImpl?: SyncFetch; now?: Date } = {},
): Promise<PollResult> {
  const config = await getPestPacConfig(companyId);
  if (!config) {
    throw new PestPacSyncError(
      "No enabled PestPac integration is configured for this company.",
      "permanent",
      "NOT_CONFIGURED",
    );
  }
  const fetchImpl = options.fetchImpl ?? ssrfSafeFetch;
  const now = options.now ?? new Date();
  const [previousRun] = await db
    .select({ cursorAfter: integrationSyncRunsTable.cursorAfter })
    .from(integrationSyncRunsTable)
    .where(
      and(
        eq(integrationSyncRunsTable.companyId, companyId),
        eq(integrationSyncRunsTable.provider, PROVIDER),
        eq(integrationSyncRunsTable.direction, "inbound"),
        eq(integrationSyncRunsTable.status, "SUCCEEDED"),
      ),
    )
    .orderBy(desc(integrationSyncRunsTable.startedAt))
    .limit(1);
  const cursorBefore = previousRun?.cursorAfter ?? null;
  const [run] = await db
    .insert(integrationSyncRunsTable)
    .values({
      companyId,
      provider: PROVIDER,
      direction: "inbound",
      entityType: "work_order",
      status: "RUNNING",
      cursorBefore,
      metadata: { resources: INBOUND_RESOURCES.map((item) => item.resource) },
    })
    .returning({ id: integrationSyncRunsTable.id });
  if (!run) throw new Error("Failed to create PestPac sync run");

  let recordsSeen = 0;
  let recordsQueued = 0;
  try {
    const headers = {
      "X-WorkWave-Key": config.apiKey,
      Accept: "application/json",
    };
    const baseUrl = config.apiBaseUrl ?? DEFAULT_BASE_URL;
    for (const definition of INBOUND_RESOURCES) {
      let pageCursor: string | null = null;
      const seenPageCursors = new Set<string>();
      for (let page = 0; page < 100; page++) {
        const pageResult = await fetchResource(
          baseUrl,
          definition.resource,
          cursorBefore,
          pageCursor,
          headers,
          fetchImpl,
        );
        recordsSeen += pageResult.records.length;
        for (const raw of pageResult.records) {
          const normalized = normalizeRecord(definition.entityType, raw);
          if (normalized && (await enqueuePestPacInboundRecord(companyId, normalized))) {
            recordsQueued++;
          }
          if (definition.entityType === "route" && Array.isArray(raw.stops)) {
            for (const stop of raw.stops) {
              if (!stop || typeof stop !== "object") continue;
              const stopRecord = normalizeRecord("work_order", {
                ...(stop as RawRecord),
                routeId: normalized?.externalId,
              });
              if (stopRecord && (await enqueuePestPacInboundRecord(companyId, stopRecord))) {
                recordsQueued++;
              }
            }
          }
        }
        const next = pageResult.nextCursor;
        if (!next || seenPageCursors.has(next)) break;
        seenPageCursors.add(next);
        pageCursor = next;
      }
    }
    const cursor = now.toISOString();
    await db
      .update(integrationSyncRunsTable)
      .set({
        status: "SUCCEEDED",
        cursorAfter: cursor,
        recordsSeen,
        recordsCreated: recordsQueued,
        finishedAt: now,
      })
      .where(eq(integrationSyncRunsTable.id, run.id));
    return { runId: run.id, recordsSeen, recordsQueued, cursor };
  } catch (error) {
    const syncError =
      error instanceof PestPacSyncError
        ? error
        : new PestPacSyncError(
            error instanceof Error ? error.message : "PestPac polling failed.",
            "retryable",
            "POLL_FAILED",
          );
    await db
      .update(integrationSyncRunsTable)
      .set({
        status: syncError.classification === "retryable" ? "PARTIAL" : "FAILED",
        recordsSeen,
        recordsCreated: recordsQueued,
        errorCode: syncError.errorCode,
        errorMessage: syncError.message,
        finishedAt: now,
      })
      .where(eq(integrationSyncRunsTable.id, run.id));
    throw syncError;
  }
}

async function upsertEntityLink(
  tx: TransactionExecutor,
  values: {
    companyId: number;
    entityType: EnterpriseSyncEntityType;
    externalId: string;
    externalParentId?: string | null;
    localEntityId?: number | null;
    payload: RawRecord;
  },
) {
  const sourceVersion =
    firstString(values.payload, ["version", "etag", "updatedAt", "lastModified", "modifiedAt"]) ??
    hashPayload(values.payload);
  const sourceUpdatedAt = firstString(values.payload, [
    "updatedAt",
    "lastModified",
    "modifiedAt",
  ]);
  const rows = await tx
    .insert(integrationEntityLinksTable)
    .values({
      companyId: values.companyId,
      provider: PROVIDER,
      entityType: values.entityType,
      localEntityId: values.localEntityId ?? null,
      externalId: values.externalId,
      externalParentId: values.externalParentId ?? null,
      externalVersion: sourceVersion,
      sourceUpdatedAt: validDate(sourceUpdatedAt),
      sourceHash: hashPayload(values.payload),
      lastSyncedAt: new Date(),
      metadata: values.payload,
    })
    .onConflictDoUpdate({
      target: [
        integrationEntityLinksTable.companyId,
        integrationEntityLinksTable.provider,
        integrationEntityLinksTable.entityType,
        integrationEntityLinksTable.externalId,
      ],
      set: {
        ...(values.localEntityId !== undefined && {
          localEntityId: values.localEntityId,
        }),
        externalParentId: values.externalParentId ?? null,
        externalVersion: sourceVersion,
        sourceUpdatedAt: validDate(sourceUpdatedAt),
        sourceHash: hashPayload(values.payload),
        lastSyncedAt: new Date(),
        metadata: values.payload,
        updatedAt: new Date(),
      },
    })
    .returning({ id: integrationEntityLinksTable.id });
  return rows[0]?.id ?? null;
}

async function applyCustomer(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
  externalId: string,
  payload: RawRecord,
) {
  const customer = mapPestPacCustomer(payload);
  if (!customer) throw new PestPacSyncError("PestPac customer has no stable ID.", "conflict", "MISSING_ID");
  await upsertEntityLink(tx, {
    companyId,
    entityType: "customer",
    externalId,
    payload,
  });
}

async function applyLocation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
  externalId: string,
  payload: RawRecord,
) {
  const location = mapPestPacLocation(payload);
  if (!location?.siteAddress.trim()) {
    throw new PestPacSyncError(
      `PestPac location ${externalId} has no service address.`,
      "conflict",
      "MISSING_ADDRESS",
    );
  }
  const addressKey = normalizeAddressKey(location.siteAddress);
  const [profile] = await tx
    .insert(propertyProfilesTable)
    .values({
      companyId,
      addressKey,
      siteAddress: location.siteAddress,
      clientName: location.displayName,
      propertyType: location.propertyType,
    })
    .onConflictDoUpdate({
      target: [propertyProfilesTable.companyId, propertyProfilesTable.addressKey],
      set: {
        siteAddress: location.siteAddress,
        ...(location.displayName !== null && { clientName: location.displayName }),
        ...(location.propertyType !== null && { propertyType: location.propertyType }),
        updatedAt: new Date(),
      },
    })
    .returning({ id: propertyProfilesTable.id });
  if (!profile) throw new Error("Failed to upsert PestPac property profile");
  await upsertEntityLink(tx, {
    companyId,
    entityType: "location",
    externalId,
    externalParentId: location.customerExternalId,
    localEntityId: profile.id,
    payload,
  });
}

async function applyRoute(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
  externalId: string,
  payload: RawRecord,
) {
  // ReadyLoq's schedule is inspection-based. The route link retains the
  // dispatch metadata while its work-order stops become scheduled inspections.
  await upsertEntityLink(tx, {
    companyId,
    entityType: "route",
    externalId,
    localEntityId: null,
    payload,
  });
}

async function applyWorkOrder(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
  externalId: string,
  payload: RawRecord,
) {
  const workOrder = mapPestPacWorkOrder(payload);
  if (!workOrder?.siteAddress.trim()) {
    throw new PestPacSyncError(
      `PestPac work order ${externalId} has no service address.`,
      "conflict",
      "MISSING_ADDRESS",
    );
  }
  const clientKey = `pestpac:${externalId}`;
  const scheduledDate = workOrder.scheduledDate ? new Date(workOrder.scheduledDate) : null;
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
    throw new PestPacSyncError(
      `PestPac work order ${externalId} has an invalid service date.`,
      "conflict",
      "INVALID_DATE",
    );
  }
  const [existing] = await tx
    .select()
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.clientKey, clientKey),
      ),
    )
    .limit(1);

  // PestPac owns dispatch metadata only until field work begins. Once ReadyLoq
  // has an in-progress/completed inspection, preserve the field record and
  // retain conflicting schedule/assignment changes for operator review.
  if (existing && existing.status !== "pending" && existing.status !== "scheduled") {
    const conflicts: Array<{
      fieldName: string;
      localValue: unknown;
      externalValue: unknown;
    }> = [];
    if (
      workOrder.scheduledDate &&
      existing.scheduledDate?.toISOString() !== scheduledDate?.toISOString()
    ) {
      conflicts.push({
        fieldName: "scheduledDate",
        localValue: existing.scheduledDate?.toISOString() ?? null,
        externalValue: scheduledDate?.toISOString() ?? null,
      });
    }
    if (
      workOrder.technicianId &&
      existing.technicianId !== workOrder.technicianId
    ) {
      conflicts.push({
        fieldName: "technicianId",
        localValue: existing.technicianId,
        externalValue: workOrder.technicianId,
      });
    }
    for (const conflict of conflicts) {
      await tx.insert(integrationConflictsTable).values({
        companyId,
        provider: PROVIDER,
        entityType: "work_order",
        localEntityId: existing.id,
        externalId,
        fieldName: conflict.fieldName,
        localValue: conflict.localValue,
        externalValue: conflict.externalValue,
      });
    }
    await upsertEntityLink(tx, {
      companyId,
      entityType: "work_order",
      externalId,
      externalParentId: workOrder.locationExternalId ?? workOrder.customerExternalId,
      localEntityId: existing.id,
      payload,
    });
    return;
  }

  const [inspection] = await tx
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: workOrder.siteAddress,
      clientName: workOrder.clientName,
      technicianName: workOrder.technicianName,
      technicianId: workOrder.technicianId,
      status: "pending",
      clientKey,
      scheduledDate,
      visitPurpose: workOrder.visitPurpose,
      unitNumber: workOrder.unitNumber,
    })
    .onConflictDoUpdate({
      target: [inspectionsTable.companyId, inspectionsTable.clientKey],
      set: {
        siteAddress: workOrder.siteAddress,
        clientName: workOrder.clientName,
        technicianName: workOrder.technicianName,
        technicianId: workOrder.technicianId,
        scheduledDate,
        visitPurpose: workOrder.visitPurpose,
        unitNumber: workOrder.unitNumber,
      },
    })
    .returning({ id: inspectionsTable.id, status: inspectionsTable.status });
  if (!inspection) throw new Error("Failed to upsert PestPac work order");

  await upsertEntityLink(tx, {
    companyId,
    entityType: "work_order",
    externalId,
    externalParentId: workOrder.locationExternalId ?? workOrder.customerExternalId,
    localEntityId: inspection.id,
    payload,
  });
}

async function applyInboundMessage(message: {
  companyId: number;
  entityType: EnterpriseSyncEntityType;
  externalId: string | null;
  payloadJson: unknown;
}) {
  if (!message.externalId) {
    throw new PestPacSyncError(
      "Inbound PestPac message has no external ID.",
      "conflict",
      "MISSING_ID",
    );
  }
  if (!message.payloadJson || typeof message.payloadJson !== "object") {
    throw new PestPacSyncError(
      "Inbound PestPac message payload is not an object.",
      "permanent",
      "INVALID_PAYLOAD",
    );
  }
  await db.transaction(async (tx) => {
    switch (message.entityType) {
      case "customer":
        await applyCustomer(tx, message.companyId, message.externalId!, message.payloadJson as RawRecord);
        break;
      case "location":
        await applyLocation(tx, message.companyId, message.externalId!, message.payloadJson as RawRecord);
        break;
      case "route":
        await applyRoute(tx, message.companyId, message.externalId!, message.payloadJson as RawRecord);
        break;
      case "work_order":
        await applyWorkOrder(tx, message.companyId, message.externalId!, message.payloadJson as RawRecord);
        break;
      default:
        throw new PestPacSyncError(
          `Unsupported inbound PestPac entity ${message.entityType}.`,
          "permanent",
          "UNSUPPORTED_ENTITY",
        );
    }
  });
}

async function dispatchInventoryUsage(
  message: ClaimedMessage,
): Promise<void> {
  const config = await getPestPacConfig(message.company_id);
  if (!config) {
    throw new PestPacSyncError(
      "PestPac integration is disabled while inventory usage is pending.",
      "unauthorized",
      "NOT_CONFIGURED",
    );
  }
  if (!message.external_id || !message.payload_json || typeof message.payload_json !== "object") {
    throw new PestPacSyncError(
      "Inventory usage message is missing its external ID or payload.",
      "permanent",
      "INVALID_PAYLOAD",
    );
  }
  const response = await ssrfSafeFetch(
    `${(config.apiBaseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/inventory/usage`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        "X-WorkWave-Key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": message.idempotency_key,
      },
      body: JSON.stringify(message.payload_json),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new PestPacSyncError(
      "PestPac rejected inventory usage credentials.",
      "unauthorized",
      "HTTP_UNAUTHORIZED",
    );
  }
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    throw new PestPacSyncError(
      `PestPac rejected inventory usage with HTTP ${response.status}.`,
      "permanent",
      "HTTP_CLIENT_ERROR",
    );
  }
  if (!response.ok) {
    throw new PestPacSyncError(
      `PestPac inventory usage returned HTTP ${response.status}.`,
      "retryable",
      "HTTP_SERVER_ERROR",
    );
  }
}

interface ClaimedMessage {
  id: number;
  company_id: number;
  provider: string;
  direction: string;
  entity_type: EnterpriseSyncEntityType;
  operation: string;
  external_id: string | null;
  idempotency_key: string;
  payload_json: unknown;
  attempt_count: number;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
}

async function claimMessages(limit: number, workerId: string): Promise<ClaimedMessage[]> {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id
      FROM integration_sync_messages
      WHERE status IN ('PENDING', 'RETRYABLE_FAILURE')
        AND available_at <= NOW()
        AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '10 minutes')
      ORDER BY available_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(limit, 100))}
    )
    UPDATE integration_sync_messages AS message
    SET status = 'PROCESSING',
        locked_at = NOW(),
        locked_by = ${workerId},
        attempt_count = message.attempt_count + 1
    FROM candidates
    WHERE message.id = candidates.id
    RETURNING message.*
  `);
  return result.rows as unknown as ClaimedMessage[];
}

async function finishMessage(
  message: ClaimedMessage,
  status: EnterpriseSyncMessageStatus,
  error?: PestPacSyncError,
) {
  await db
    .update(integrationSyncMessagesTable)
    .set({
      status,
      lockedAt: null,
      lockedBy: null,
      processedAt: status === "SUCCEEDED" ? new Date() : null,
      availableAt:
        status === "RETRYABLE_FAILURE"
          ? new Date(Date.now() + retryDelayMs(message.attempt_count))
          : new Date(),
      lastErrorCode: error?.errorCode ?? null,
      lastErrorMessage: error?.message ?? null,
    })
    .where(eq(integrationSyncMessagesTable.id, message.id));
}

export async function processPendingPestPacMessages(
  options: { limit?: number; workerId?: string } = {},
): Promise<{ claimed: number; succeeded: number; failed: number }> {
  const messages = await claimMessages(
    options.limit ?? 25,
    options.workerId ?? `pestpac-worker-${randomUUID()}`,
  );
  let succeeded = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      if (message.attempt_count > MAX_MESSAGE_ATTEMPTS) {
        throw new PestPacSyncError(
          "PestPac message exceeded the automatic retry limit.",
          "permanent",
          "MAX_ATTEMPTS",
        );
      }
      if (message.direction === "inbound") {
        await applyInboundMessage({
          companyId: message.company_id,
          entityType: message.entity_type,
          externalId: message.external_id,
          payloadJson: message.payload_json,
        });
      } else if (message.entity_type === "inventory_usage") {
        await dispatchInventoryUsage(message);
      } else {
        throw new PestPacSyncError(
          `Unsupported outbound PestPac entity ${message.entity_type}.`,
          "permanent",
          "UNSUPPORTED_ENTITY",
        );
      }
      await finishMessage(message, "SUCCEEDED");
      succeeded++;
    } catch (rawError) {
      const error =
        rawError instanceof PestPacSyncError
          ? rawError
          : new PestPacSyncError(
              rawError instanceof Error ? rawError.message : "PestPac message failed.",
              "retryable",
              "MESSAGE_FAILED",
            );
      const status: EnterpriseSyncMessageStatus =
        error.classification === "unauthorized"
          ? "UNAUTHORIZED"
          : error.classification === "conflict"
            ? "CONFLICT"
            : error.classification === "permanent" || message.attempt_count >= MAX_MESSAGE_ATTEMPTS
              ? "PERMANENT_FAILURE"
              : "RETRYABLE_FAILURE";
      if (error.classification === "conflict") {
        await db
          .insert(integrationConflictsTable)
          .values({
            companyId: message.company_id,
            provider: PROVIDER,
            entityType: message.entity_type,
            externalId: message.external_id,
            fieldName: "record",
            externalValue: message.payload_json,
          })
          .catch((conflictError) => {
            logger.error(
              { conflictError, messageId: message.id },
              "[pestpac-sync] failed to retain conflict",
            );
          });
      }
      await finishMessage(message, status, error);
      failed++;
      logger.warn(
        { companyId: message.company_id, messageId: message.id, status, error: error.message },
        "[pestpac-sync] message processing failed",
      );
    }
  }
  return { claimed: messages.length, succeeded, failed };
}

export async function getPestPacSyncStatus(companyId: number) {
  const [counts, conflicts, latestRun] = await Promise.all([
    db
      .select({
        status: integrationSyncMessagesTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(integrationSyncMessagesTable)
      .where(
        and(
          eq(integrationSyncMessagesTable.companyId, companyId),
          eq(integrationSyncMessagesTable.provider, PROVIDER),
        ),
      )
      .groupBy(integrationSyncMessagesTable.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(integrationConflictsTable)
      .where(
        and(
          eq(integrationConflictsTable.companyId, companyId),
          eq(integrationConflictsTable.provider, PROVIDER),
          eq(integrationConflictsTable.status, "open"),
        ),
      ),
    db
      .select()
      .from(integrationSyncRunsTable)
      .where(
        and(
          eq(integrationSyncRunsTable.companyId, companyId),
          eq(integrationSyncRunsTable.provider, PROVIDER),
        ),
      )
      .orderBy(desc(integrationSyncRunsTable.startedAt))
      .limit(1),
  ]);
  return {
    provider: PROVIDER,
    messages: Object.fromEntries(counts.map((row) => [row.status, row.count])),
    openConflictCount: conflicts[0]?.count ?? 0,
    latestRun: latestRun[0] ?? null,
  };
}

export async function enqueuePestPacInventoryUsage(
  companyId: number,
  treatmentLogId: number,
): Promise<boolean> {
  const config = await getPestPacConfig(companyId);
  if (!config) return false;
  const [row] = await db
    .select({
      log: treatmentLogsTable,
      productName: productsTable.name,
    })
    .from(treatmentLogsTable)
    .innerJoin(productsTable, eq(productsTable.id, treatmentLogsTable.productId))
    .where(
      and(
        eq(treatmentLogsTable.companyId, companyId),
        eq(treatmentLogsTable.id, treatmentLogId),
      ),
    )
    .limit(1);
  if (!row) return false;
  const [workOrderLink] = await db
    .select({ externalId: integrationEntityLinksTable.externalId })
    .from(integrationEntityLinksTable)
    .where(
      and(
        eq(integrationEntityLinksTable.companyId, companyId),
        eq(integrationEntityLinksTable.provider, PROVIDER),
        eq(integrationEntityLinksTable.entityType, "work_order"),
        eq(integrationEntityLinksTable.localEntityId, row.log.inspectionId),
      ),
    )
    .limit(1);
  const payload = {
    treatmentLogId,
    inspectionId: row.log.inspectionId,
    externalWorkOrderId: workOrderLink?.externalId ?? null,
    productId: row.log.productId,
    productName: row.productName,
    quantity: row.log.totalProductOz,
    unit: "fl oz",
    appliedAt: row.log.appliedAt.toISOString(),
    technicianId: row.log.technicianId,
    targetPest: row.log.targetPest,
  };
  const inserted = await db
    .insert(integrationSyncMessagesTable)
    .values({
      companyId,
      provider: PROVIDER,
      direction: "outbound",
      entityType: "inventory_usage",
      operation: "usage",
      localEntityId: treatmentLogId,
      externalId: String(treatmentLogId),
      idempotencyKey: `outbound:${PROVIDER}:inventory_usage:${treatmentLogId}`,
      payloadJson: payload,
    })
    .onConflictDoNothing({
      target: [
        integrationSyncMessagesTable.companyId,
        integrationSyncMessagesTable.provider,
        integrationSyncMessagesTable.idempotencyKey,
      ],
    })
    .returning({ id: integrationSyncMessagesTable.id });
  return inserted.length > 0;
}
