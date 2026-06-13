import { db } from "@workspace/db";
import { propertyProfilesTable, propertyNotesTable } from "@workspace/db";
import type { Hotspot } from "@workspace/db";
import { normalizeAddressKey } from "./lib/property-intelligence";

// Idempotent: only seeds when property_profiles is empty. Attaches authored
// intelligence to addresses that already have inspections/analyses so the
// derived sections (recurring issues, photos, visit history) also populate.

type ProfileSeed = {
  siteAddress: string;
  clientName: string;
  propertyType: string;
  technicianKnowledge: string;
  hotspots: Hotspot[];
  notes: { note: string; zone?: string; category?: string; authorName?: string; daysAgo: number }[];
};

const PROFILES: ProfileSeed[] = [
  {
    siteAddress: "1842 Riverside Dr, Austin, TX 78701",
    clientName: "Riverside Apartments",
    propertyType: "Multifamily",
    technicianKnowledge:
      "Large 220-unit complex. Front gate code is on file with the leasing office — call ahead. Building C dumpster corral is the chronic problem area; German roach pressure spikes there every summer. Maintenance lead (Marcus) is very responsive and will open mechanical rooms on request.",
    hotspots: [
      { zone: "Building C trash corral", description: "Recurring German roach harborage near the compactor seams.", severity: "high" },
      { zone: "Unit 112 kitchen", description: "Plumbing void under sink — repeat ant trailing in spring.", severity: "medium" },
      { zone: "Pool equipment room", description: "Standing water and conducive conditions; check after rain.", severity: "medium" },
    ],
    notes: [
      { note: "Leasing office requested we avoid Tuesday mornings (turnover walk-throughs).", category: "Access", authorName: "Dana Whitfield", daysAgo: 40 },
      { note: "Placed monitoring stations in Building C corral. Marcus aware.", zone: "Building C trash corral", category: "Treatment", authorName: "Dana Whitfield", daysAgo: 12 },
    ],
  },
  {
    siteAddress: "920 Oak Street, Dallas, TX 75201",
    clientName: "Oak Park Restaurant Group",
    propertyType: "Restaurant",
    technicianKnowledge:
      "Active kitchen — service after 2pm only, never during lunch rush. Health inspections are frequent here, so documentation matters. Dish pit and the dry storage back corner are the two zones that drive callbacks. Manager keeps the grease trap log in the back office.",
    hotspots: [
      { zone: "Dish pit", description: "Drain fly breeding in floor drains; needs bio-foam treatment.", severity: "high" },
      { zone: "Dry storage back corner", description: "Rodent rub marks along the wall-floor junction.", severity: "high" },
      { zone: "Bar speed rail", description: "Small fly activity near fruit garnish station.", severity: "low" },
    ],
    notes: [
      { note: "Owner prefers green/IPM-forward products in food prep zones. No baseboard sprays in kitchen.", category: "Preference", authorName: "Luis Romero", daysAgo: 33 },
      { note: "Sealed gap under back dock door with door sweep. Recommend re-check next visit.", zone: "Dry storage back corner", category: "Exclusion", authorName: "Luis Romero", daysAgo: 9 },
    ],
  },
];

async function main() {
  const existing = await db.select().from(propertyProfilesTable);
  if (existing.length > 0) {
    console.log(`property_profiles already has ${existing.length} rows — skipping (idempotent).`);
    return;
  }

  for (const p of PROFILES) {
    const addressKey = normalizeAddressKey(p.siteAddress);
    await db.insert(propertyProfilesTable).values({
      addressKey,
      siteAddress: p.siteAddress,
      clientName: p.clientName,
      propertyType: p.propertyType,
      technicianKnowledge: p.technicianKnowledge,
      hotspots: p.hotspots,
    });

    for (const n of p.notes) {
      await db.insert(propertyNotesTable).values({
        addressKey,
        note: n.note,
        zone: n.zone ?? null,
        category: n.category ?? null,
        authorName: n.authorName ?? null,
        createdAt: new Date(Date.now() - n.daysAgo * 24 * 60 * 60 * 1000),
      });
    }
    console.log(`Seeded profile for ${p.siteAddress} (${addressKey}) with ${p.notes.length} notes.`);
  }

  console.log("Property intelligence seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
