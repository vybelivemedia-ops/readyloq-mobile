import { db } from "@workspace/db";
import { inspectionsTable, callbacksTable } from "@workspace/db";
import { getSeedCompanyId } from "./lib/seed-company";

// Idempotent seed for the Callback Intelligence chains used by ReadyLoq Command.
// Safe to run multiple times: it no-ops if callbacks already exist. It references
// REAL inspection ids (never inserts inspections) and backdates createdAt across
// ~6 months so the trend widgets render meaningfully.

function propertyTypeFor(clientName: string | null, siteAddress: string): string {
  const s = `${clientName ?? ""} ${siteAddress}`.toLowerCase();
  if (s.includes("warehouse") || s.includes("industrial")) return "Warehouse";
  if (s.includes("restaurant") || s.includes("bakery") || s.includes("cafe") || s.includes("kitchen")) return "Restaurant";
  if (s.includes("apartment") || s.includes("hoa") || s.includes("residence hall") || s.includes("campus")) return "Multifamily";
  if (s.includes("office") || s.includes("commerce") || s.includes("square")) return "Commercial";
  if (s.includes("residence") || s.includes("home") || s.includes("house")) return "Single Family";
  return "Commercial";
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

async function seedCallbacks() {
  const existing = await db.select().from(callbacksTable);
  if (existing.length > 0) {
    console.log(`Callbacks already seeded (${existing.length} rows). Skipping.`);
    return;
  }

  const inspections = await db.select().from(inspectionsTable);
  if (inspections.length === 0) {
    console.log("No inspections found — run the main seed first. Skipping callbacks.");
    return;
  }

  const byClient = (needle: string) =>
    inspections.find((i) => (i.clientName ?? "").toLowerCase().includes(needle.toLowerCase())) ?? inspections[0];

  // [clientNeedle, pestType, finding, recommendation|null, followUp, outcome, callbackCause|null, conduciveCondition|null, daysAgoCreated]
  const rows: Array<[
    string, string, string, string | null, boolean,
    "activity_reduced" | "resolved" | "callback_occurred" | "pending",
    string | null, string | null, number,
  ]> = [
    // Riverside Apartments — Multifamily (Rodents / Cockroaches)
    ["Riverside", "Rodents", "Mouse droppings in shared trash room", "Bait placement + sanitation schedule", true, "activity_reduced", null, "Accumulated waste in trash room", 150],
    ["Riverside", "Rodents", "Utility penetration near water heater", null, false, "callback_occurred", "missing_exclusion", "Open utility penetration", 138],
    ["Riverside", "Rodents", "Recurring rodent activity in laundry room", "Exclusion hardware + bait stations", true, "activity_reduced", null, "Gaps around dryer venting", 95],
    ["Riverside", "Cockroaches", "German cockroach harborage in unit 3B", "Gel bait + IGR application", true, "resolved", null, "Moisture under kitchen sink", 60],

    // Oak Park Restaurant — Restaurant (Cockroaches / Flies)
    ["Oak Park", "Cockroaches", "German cockroach activity in food prep area", "Gel bait at harborage sites", true, "activity_reduced", null, "Grease accumulation under equipment", 145],
    ["Oak Park", "Cockroaches", "Standing water under dishwasher", null, false, "callback_occurred", "recurring_moisture", "Standing moisture at dish station", 120],
    ["Oak Park", "Flies", "Drain fly breeding in floor drains", "Bio-enzymatic drain treatment", true, "resolved", null, "Organic buildup in floor drains", 70],
    ["Oak Park", "Cockroaches", "Cockroach recurrence along fryer line", "Re-bait + degreasing protocol", true, "callback_occurred", "repeated_cockroach", "Grease accumulation under equipment", 40],

    // Lakewood Residence — Single Family (Termites)
    ["Lakewood", "Termites", "Subterranean termite mud tubes on foundation", "Liquid termiticide barrier", true, "activity_reduced", null, "Soil-to-wood contact at siding", 130],
    ["Lakewood", "Termites", "Persistent moisture in crawlspace", null, false, "callback_occurred", "recurring_moisture", "Crawlspace moisture / poor ventilation", 85],

    // Commerce Square Office — Commercial (Ants)
    ["Commerce", "Ants", "Odorous house ant trail in break room", "Non-repellent perimeter application", true, "resolved", null, null, 110],
    ["Commerce", "Ants", "Ant activity recurring at exterior door", "Bait + exclusion at threshold", true, "activity_reduced", null, "Missing door sweep at exterior door", 55],

    // Maple Ridge HOA — Multifamily (Bed Bugs / Fleas)
    ["Maple Ridge", "Bed Bugs", "Bed bug activity in unit 4B", "Whole-room heat treatment", true, "resolved", null, null, 100],
    ["Maple Ridge", "Bed Bugs", "Bed bug reintroduction in unit 5C", "Follow-up heat treatment + monitors", true, "callback_occurred", "adjacent_spread", "Shared wall void between units", 62],
    ["Maple Ridge", "Fleas", "Flea activity in common hallway carpet", "IGR + vacuum protocol", true, "activity_reduced", null, null, 48],

    // AustoTex Warehouse — Warehouse (Rodents / Wildlife)
    ["AustoTex", "Rodents", "Rat activity in storage racking", "Interior + exterior bait stations", true, "activity_reduced", null, "Dock doors left open", 125],
    ["AustoTex", "Rodents", "Undocumented entry point at loading dock", null, false, "callback_occurred", "undocumented_entry", "Gaps at dock door seals", 90],
    ["AustoTex", "Rodents", "Repeated rodent activity near break area", "Sanitation + bait reinforcement", true, "callback_occurred", "repeated_rodent", "Food debris near break area", 35],
    ["AustoTex", "Wildlife", "Raccoon roof access via damaged soffit", "Soffit repair + one-way exclusion door", true, "resolved", null, "Damaged soffit at roofline", 65],

    // Pecan Street Bakery — Restaurant (Flies / Ants)
    ["Pecan", "Flies", "Fruit fly breeding at floor drains", "Bio-drain treatment program", true, "activity_reduced", null, "Organic buildup in floor drains", 105],
    ["Pecan", "Ants", "Ant trail at rear entry", "Perimeter bait + threshold seal", true, "resolved", null, "Missing door sweep at rear entry", 50],

    // Campus Residence Hall — Multifamily (Bed Bugs)
    ["Campus", "Bed Bugs", "Bed bug complaints across multiple rooms", "Canine inspection + targeted heat", true, "activity_reduced", null, null, 75],
    ["Campus", "Bed Bugs", "Bed bug spread to adjacent room", null, false, "callback_occurred", "adjacent_spread", "Shared wall void between rooms", 28],
  ];

  const companyId = await getSeedCompanyId();
  const values: (typeof callbacksTable.$inferInsert)[] = rows.map(([needle, pestType, finding, recommendation, followUpVisit, outcome, callbackCause, conduciveCondition, dAgo]) => {
    const insp = byClient(needle);
    const createdAt = daysAgo(dAgo);
    const resolved = outcome === "resolved" || outcome === "activity_reduced";
    return {
      companyId,
      inspectionId: insp.id,
      propertyType: propertyTypeFor(insp.clientName, insp.siteAddress),
      pestType,
      finding,
      recommendation,
      followUpVisit,
      outcome,
      callbackCause,
      conduciveCondition,
      createdAt,
      resolvedAt: resolved ? plusDays(createdAt, 14) : null,
    };
  });

  await db.insert(callbacksTable).values(values);
  console.log(`Seeded ${values.length} callback chains.`);
}

seedCallbacks()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
