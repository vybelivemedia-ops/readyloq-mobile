import { db } from "@workspace/db";
import { brandingProfilesTable, READYLOQ_DEFAULT_PROFILE } from "@workspace/db";

const SUBURBAN_DEMO = {
  name: "Suburban Pest Control",
  isDefault: false,
  isActive: false,
  companyName: "Suburban Pest Control",
  tagline: "Your neighborhood pest experts since 1998",
  companyAddress: "1420 Oakmont Drive, Springfield, IL 62704",
  companyPhone: "(217) 555-0182",
  companyEmail: "service@suburbanpest.com",
  companyWebsite: "https://suburbanpest.com",
  licenseNumber: "IL-PCO-44821",
  logoUrl: "/suburban-logo.png",
  appIconUrl: "/suburban-logo.png",
  primaryColor: "#16a34a",
  secondaryColor: "#14532d",
  accentColor: "#f59e0b",
  reportFooterText: "Suburban Pest Control — Trusted Local Service",
  supportInfo: "(217) 555-0182  ·  service@suburbanpest.com",
  signatureDisclaimer:
    "This report certifies that a pest control inspection was conducted by a Suburban Pest Control licensed technician. Findings reflect conditions observed at the time of service.",
  emailSenderName: "Suburban Pest Control",
  emailReplyTo: "service@suburbanpest.com",
  emailFooter: "Suburban Pest Control · (217) 555-0182 · suburbanpest.com",
  poweredByVisible: false,
};

async function run() {
  const existing = await db.select().from(brandingProfilesTable);
  if (existing.length > 0) {
    console.log(`Branding profiles already exist (${existing.length}). Skipping seed.`);
    process.exit(0);
  }
  await db.insert(brandingProfilesTable).values([
    { ...READYLOQ_DEFAULT_PROFILE, isDefault: true, isActive: true },
    SUBURBAN_DEMO,
  ]);
  console.log("Seeded branding profiles: ReadyLoq Default (active) + Suburban Pest Control.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
