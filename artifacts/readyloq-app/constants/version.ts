/**
 * Single source of truth for user-facing version metadata.
 * Keep in sync with app.json (expo.version / android.versionCode /
 * ios.buildNumber) and package.json when cutting a release.
 */
export const APP_VERSION = "0.9.0";
export const VERSION_NAME = "ReadyLoq Beta 0.9.0";
export const CODENAME = "Opportunity Intelligence";
export const RELEASE_TYPE = "Closed Beta";
export const ANDROID_VERSION_CODE = 7;

export const RELEASE_NOTES: { title: string; items: string[] }[] = [
  {
    title: "Major Features",
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
    title: "Performance",
    items: [
      "Improved stability",
      "Background processing improvements",
      "SDK 54 alignment",
      "Updated package versions",
      "Improved build reliability",
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
