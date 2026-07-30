import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Chemical product catalogue & treatment log route tests.
 *
 * Coverage:
 *  - GET /products returns the full seeded catalogue
 *  - GET /products?pest= filters correctly (only on-label products returned)
 *  - GET /products?pest=&site= applies both filters
 *  - GET /products/:id returns a single product with label rules inline
 *  - GET /products/:id/label-rules returns label rules for a product
 *  - POST /inspections/:id/treatment-logs 201 when rate is within label max
 *  - POST /inspections/:id/treatment-logs 422 when rate exceeds label max
 *  - GET  /inspections/:id/treatment-logs returns logs with product detail
 */

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  treatmentLogsTable,
  productsTable,
  productLabelRulesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const OWNER_ID = "products_test_owner_clerk_id";
const TECH_ID = "products_test_tech_clerk_id";
const SLUG = "products-test-co";

let companyId: number;
let inspectionId: number;
/** A product inserted by the test suite (not from global seed). */
let testProductId: number;
let testLabelRulesId: number;
/** maxRateOzPer1000Sqft for the test product — used in rate-limit tests. */
const MAX_RATE = 1.0;

function asUser(id: string | null) {
  authState.userId = id;
}

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

beforeAll(async () => {
  companyId = await findOrCreateCompany("Products Test Co", SLUG);

  // Ensure clean slate for this suite.
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));

  await db.insert(usersTable).values([
    { clerkUserId: OWNER_ID, role: "owner", companyId },
    { clerkUserId: TECH_ID, role: "technician", companyId },
  ]);

  // Create an inspection to attach treatment logs to.
  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: "123 Test Street, Anytown, USA",
      technicianName: "Test Tech",
      technicianId: TECH_ID,
      status: "pending",
    })
    .returning();
  inspectionId = insp.id;

  // Insert a dedicated test product (separate from global seed data so these
  // tests are deterministic regardless of seed state).
  const [product] = await db
    .insert(productsTable)
    .values({
      name: "TestCide Pro",
      epaRegistrationNumber: "TESTONLY-001",
      productType: "general-use",
      activeIngredients: "Test Ingredient 1.0%",
      signalWord: "CAUTION",
      manufacturerName: "ReadyLoq Test Labs",
      isActive: true,
    })
    .returning();
  testProductId = product.id;

  const [rules] = await db
    .insert(productLabelRulesTable)
    .values({
      productId: testProductId,
      approvedPestTypes: ["Rodents", "Cockroaches"],
      approvedSiteClassifications: ["residential_interior", "commercial_exterior"],
      requiredEquipmentTypes: ["compressed_air_sprayer"],
      nozzleSpec: "Fan tip",
      pressurePsi: "40 psi",
      dropletSize: "Medium",
      maxRateOzPer1000Sqft: MAX_RATE,
      maxRateOzPerGallon: 0.5,
      mixingSteps: ["Add half water", "Add product", "Fill remainder"],
      maxTempF: 90,
      phytotoxicityNotes: null,
      reEntryIntervalHours: 4,
    })
    .returning();
  testLabelRulesId = rules.id;
});

beforeEach(() => {
  asUser(null);
});

// ─── Product catalogue ─────────────────────────────────────────────────────────

describe("GET /products", () => {
  it("returns products for authenticated user (includes test product)", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = (res.body as { id: number }[]).map((p) => p.id);
    expect(ids).toContain(testProductId);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(401);
  });

  it("filters by pest type — only returns products approved for Rodents", async () => {
    asUser(TECH_ID);
    const res = await request(app).get("/api/products?pest=Rodents");
    expect(res.status).toBe(200);
    const products = res.body as Array<{
      id: number;
      labelRules: { approvedPestTypes: string[] } | null;
    }>;
    // Every returned product must include "Rodents" in its approved pest types.
    for (const p of products) {
      expect(p.labelRules?.approvedPestTypes).toContain("Rodents");
    }
    // Our test product is approved for Rodents — it should be present.
    expect(products.map((p) => p.id)).toContain(testProductId);
  });

  it("filters by pest type — excludes products NOT approved for Wildlife", async () => {
    asUser(TECH_ID);
    const res = await request(app).get("/api/products?pest=Wildlife");
    expect(res.status).toBe(200);
    // Our test product is only approved for Rodents and Cockroaches — not Wildlife.
    const ids = (res.body as { id: number }[]).map((p) => p.id);
    expect(ids).not.toContain(testProductId);
  });

  it("filters by pest AND site — returns intersection", async () => {
    asUser(TECH_ID);
    // TestCide Pro: approved for Rodents + residential_interior → should match.
    const res = await request(app).get(
      "/api/products?pest=Rodents&site=residential_interior",
    );
    expect(res.status).toBe(200);
    const products = res.body as Array<{
      id: number;
      labelRules: { approvedPestTypes: string[]; approvedSiteClassifications: string[] } | null;
    }>;
    for (const p of products) {
      expect(p.labelRules?.approvedPestTypes).toContain("Rodents");
      expect(p.labelRules?.approvedSiteClassifications).toContain("residential_interior");
    }
    expect(products.map((p) => p.id)).toContain(testProductId);
  });

  it("pest + site combination excludes off-label entries", async () => {
    asUser(TECH_ID);
    // TestCide Pro is NOT approved for food_handling_area → should be excluded.
    const res = await request(app).get(
      "/api/products?pest=Rodents&site=food_handling_area",
    );
    expect(res.status).toBe(200);
    const ids = (res.body as { id: number }[]).map((p) => p.id);
    expect(ids).not.toContain(testProductId);
  });

  it("includes labelRules inline on each product", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get(`/api/products?pest=Rodents`);
    expect(res.status).toBe(200);
    const p = (res.body as Array<{ id: number; labelRules: unknown | null }>)
      .find((x) => x.id === testProductId);
    expect(p).toBeDefined();
    expect(p?.labelRules).not.toBeNull();
  });
});

describe("GET /products/:id", () => {
  it("returns a single product with label rules", async () => {
    asUser(TECH_ID);
    const res = await request(app).get(`/api/products/${testProductId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(testProductId);
    expect(res.body.name).toBe("TestCide Pro");
    expect(res.body.labelRules).not.toBeNull();
    expect(res.body.labelRules.maxRateOzPer1000Sqft).toBe(MAX_RATE);
  });

  it("returns 404 for unknown id", async () => {
    asUser(TECH_ID);
    const res = await request(app).get("/api/products/999999");
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/products/${testProductId}`);
    expect(res.status).toBe(401);
  });
});

describe("GET /products/:id/label-rules", () => {
  it("returns label rules for the product", async () => {
    asUser(TECH_ID);
    const res = await request(app).get(
      `/api/products/${testProductId}/label-rules`,
    );
    expect(res.status).toBe(200);
    expect(res.body.productId).toBe(testProductId);
    expect(res.body.maxRateOzPer1000Sqft).toBe(MAX_RATE);
    expect(Array.isArray(res.body.mixingSteps)).toBe(true);
    expect(res.body.mixingSteps.length).toBeGreaterThan(0);
  });
});

// ─── Treatment logs ────────────────────────────────────────────────────────────

describe("POST /inspections/:id/treatment-logs", () => {
  it("creates a treatment log when the rate is within the label maximum", async () => {
    asUser(TECH_ID);
    // 0.5 oz over 1000 sqft = 0.5 oz/1000 sqft — below MAX_RATE of 1.0
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .send({
        productId: testProductId,
        targetPest: "Rodents",
        siteClassification: "residential_interior",
        areaSqft: 1000,
        totalProductOz: 0.5,
        dilutionOzPerGallon: 0.5,
        equipmentUsed: "compressed_air_sprayer",
        checklistItems: [
          { label: "Nitrile gloves worn", checked: true },
          { label: "Eye protection worn", checked: true },
        ],
        tempAtApplicationF: 72,
        environmentalWarningAcknowledged: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.productId).toBe(testProductId);
    expect(res.body.targetPest).toBe("Rodents");
    expect(res.body.totalProductOz).toBe(0.5);
  });

  it("returns 422 when the submitted rate exceeds the label maximum", async () => {
    asUser(TECH_ID);
    // 5 oz over 1000 sqft = 5.0 oz/1000 sqft — ABOVE MAX_RATE of 1.0
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .send({
        productId: testProductId,
        targetPest: "Rodents",
        siteClassification: "residential_interior",
        areaSqft: 1000,
        totalProductOz: 5.0, // ← 5× over the label maximum
        equipmentUsed: "compressed_air_sprayer",
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("rate_exceeds_label_maximum");
    expect(res.body.appliedRate).toBeGreaterThan(MAX_RATE);
    expect(res.body.maxRate).toBe(MAX_RATE);
    expect(res.body.productName).toBe("TestCide Pro");
  });

  it("returns 422 for a boundary excess (rate = maxRate + tiny epsilon)", async () => {
    asUser(TECH_ID);
    // 1.001 oz over 1000 sqft = 1.001 oz/1000 sqft — just over MAX_RATE 1.0
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .send({
        productId: testProductId,
        targetPest: "Cockroaches",
        siteClassification: "commercial_exterior",
        areaSqft: 1000,
        totalProductOz: 1.001,
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("rate_exceeds_label_maximum");
  });

  it("allows submission when areaSqft is absent (no rate validation possible)", async () => {
    asUser(TECH_ID);
    // No areaSqft → rate calculation is impossible → skip guard and accept.
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .send({
        productId: testProductId,
        targetPest: "Rodents",
        siteClassification: "residential_interior",
        totalProductOz: 99, // high, but can't validate without area
        linearFt: 50,
      });
    expect(res.status).toBe(201);
  });

  it("returns 404 for an inspection in another company", async () => {
    // companyId is for OWNER_ID's company; create a second company.
    const otherId = await (async () => {
      const [r] = await db
        .insert(companiesTable)
        .values({ name: "Other Co", slug: "products-test-other" })
        .onConflictDoNothing()
        .returning();
      if (r) return r.id;
      const [existing] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.slug, "products-test-other"));
      return existing.id;
    })();

    const [otherInsp] = await db
      .insert(inspectionsTable)
      .values({
        companyId: otherId,
        siteAddress: "999 Other Lane",
        technicianName: "Other Tech",
        status: "pending",
      })
      .returning();

    asUser(TECH_ID); // belongs to companyId, not otherId
    const res = await request(app)
      .post(`/api/inspections/${otherInsp.id}/treatment-logs`)
      .send({
        productId: testProductId,
        targetPest: "Rodents",
        siteClassification: "residential_interior",
      });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a missing required field (productId)", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .send({ targetPest: "Rodents", siteClassification: "residential_interior" });
    expect(res.status).toBe(400);
  });
});

describe("GET /inspections/:id/treatment-logs", () => {
  it("returns treatment logs for the inspection with product detail", async () => {
    asUser(TECH_ID);
    const res = await request(app).get(
      `/api/inspections/${inspectionId}/treatment-logs`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // At least one log was created in the POST tests.
    expect(res.body.length).toBeGreaterThan(0);
    const log = res.body[0] as {
      productId: number;
      product: { id: number; name: string } | null;
    };
    expect(log.product).not.toBeNull();
    expect(log.product?.name).toBeDefined();
  });

  it("requires authentication", async () => {
    const res = await request(app).get(
      `/api/inspections/${inspectionId}/treatment-logs`,
    );
    expect(res.status).toBe(401);
  });
});
