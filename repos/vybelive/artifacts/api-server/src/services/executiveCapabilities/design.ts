// ─── Creative Director capability: design tokens + asset inventory ────────────
import path from "path";
import type { ExecutiveReport } from "./index.js";
import { findRepoRoot, walkFiles, isImageFile, readTextSafe, listFiles } from "./repo.js";

export async function inspectDesign(): Promise<ExecutiveReport> {
  const root = findRepoRoot();

  // Design tokens from the mobile dark-only palette.
  const colorsSrc = readTextSafe(path.join(root, "artifacts/mobile/constants/colors.ts")) ?? "";
  const hexTokens = new Set(colorsSrc.match(/#[0-9a-fA-F]{6}\b/g) ?? []);

  // UI component inventory.
  const mcUi = listFiles(path.join(root, "artifacts/mission-control/src/components/ui")).filter((f) =>
    f.endsWith(".tsx"),
  ).length;

  // Mobile screens (Expo Router file-based routes).
  let mobileScreens = 0;
  for (const f of walkFiles(path.join(root, "artifacts/mobile/app"))) {
    if (f.endsWith(".tsx")) mobileScreens++;
  }

  // Image asset inventory across attached assets + artifact public/asset dirs.
  let images = 0;
  let generatedImages = 0;
  const assetRoots = [
    path.join(root, "attached_assets"),
    path.join(root, "artifacts/website/public"),
    path.join(root, "artifacts/marketing/public"),
    path.join(root, "artifacts/mobile/assets"),
  ];
  for (const dir of assetRoots) {
    for (const f of walkFiles(dir)) {
      if (!isImageFile(f)) continue;
      images++;
      if (f.includes("generated_images")) generatedImages++;
    }
  }

  const findings: ExecutiveReport["findings"] = [];
  if (hexTokens.size === 0) {
    findings.push({ severity: "warning", text: "No color tokens found in the mobile palette." });
  } else {
    findings.push({
      severity: "info",
      text: `${hexTokens.size} unique color token(s) define the dark-only palette.`,
    });
  }
  if (images === 0) {
    findings.push({ severity: "warning", text: "No image assets found in known asset directories." });
  } else {
    findings.push({
      severity: "info",
      text: `${images} image asset(s) on hand (${generatedImages} AI-generated).`,
    });
  }
  findings.push({
    severity: "info",
    text: `${mcUi} reusable UI components and ${mobileScreens} mobile screens in the design system.`,
  });

  const status: ExecutiveReport["status"] =
    hexTokens.size === 0 || images === 0 ? "attention" : "healthy";

  return {
    status,
    headline: `${hexTokens.size} color tokens, ${images} assets, ${mcUi} UI components`,
    summary:
      `The dark-only design system uses ${hexTokens.size} unique color token(s). ` +
      `There are ${mcUi} reusable UI components and ${mobileScreens} mobile screens. ` +
      `Asset library holds ${images} image(s), of which ${generatedImages} are AI-generated.`,
    metrics: [
      { label: "Color tokens", value: String(hexTokens.size) },
      { label: "Image assets", value: String(images) },
      { label: "AI-generated", value: String(generatedImages) },
      { label: "UI components", value: String(mcUi) },
      { label: "Mobile screens", value: String(mobileScreens) },
    ],
    findings,
  };
}
