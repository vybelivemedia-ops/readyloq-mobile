/**
 * Single source of truth for user-facing version metadata.
 * Keep in sync with app.json (expo.version / android.versionCode /
 * ios.buildNumber) and package.json when cutting a release.
 */
export const APP_VERSION = "0.9.1";
export const VERSION_NAME = "ReadyLoq Beta 0.9.1";
export const CODENAME = "Hardened Intelligence";
export const RELEASE_TYPE = "Closed Beta";
export const ANDROID_VERSION_CODE = 11;

export const RELEASE_NOTES: { title: string; items: string[] }[] = [
  {
    title: "What's New in 0.9.1",
    items: [
      "Send reports directly after preview — no need to regenerate the PDF",
      "Infinite scroll on the at-risk inspections list for large portfolios",
      "AI findings are now validated at write time — malformed data is rejected before it reaches the database",
      "Reports with no AI findings display correctly (no blank or crashed screen)",
    ],
  },
  {
    title: "Security & Data Integrity",
    items: [
      "Cross-tenant data isolation hardened across briefing, media, and report endpoints",
      "Report share links strictly scoped to the requesting company",
      "Media registration now includes company scope check as defense-in-depth",
      "Severity and media-type fields validated against explicit allowlists before database writes",
    ],
  },
  {
    title: "Code Quality",
    items: [
      "Structured logging (pino) adopted across all API routes and services — raw console calls removed",
      "Non-null assertions replaced with explicit guards throughout BLE layer",
      "Ionicons icon names fully typed — eliminates hidden runtime mismatch risk",
      "Briefing domain constants named (stale window, reporting window, quality threshold)",
      "Money formatter consolidated — three divergent implementations replaced with one shared utility",
    ],
  },
  {
    title: "Major Features (0.9.0)",
    items: [
      "Fold 7 and large-screen optimization",
      "Responsive tablet and foldable layouts",
      "AI Inspection Workspace",
      "Live Report Builder",
      "AI Inspection Panel",
      "Opportunity Intelligence",
      "Inspection Scorecards",
      "Customer Property Summaries",
      "Sales Proposal Builder",
      "Management Intelligence Dashboard",
      "Background AI processing",
      "Role-based intelligence views",
      "Evidence-grounded AI recommendations",
      "Anti-fabrication safeguards",
      "Secure customer share links",
      "Opportunity notes and audit history",
    ],
  },
  {
    title: "Known Upcoming Features",
    items: [
      "Company Learning Engine",
      "Company Playbooks",
      "Property Memory",
      "Executive Intelligence Dashboard",
      "PestPac Integration",
      "FieldRoutes Integration",
    ],
  },
];
