/**
 * Commercial Pricing Engine — client side
 *
 * Mirrors the server-side pricing logic so the mobile app can display
 * estimated contract values on lead cards and in the Saved Reports section
 * for inspections whose server opportunity hasn't been created yet.
 *
 * Keep in sync with artifacts/api-server/src/lib/pricing.ts.
 */

export interface PricingRule {
  annualMin: number;
  annualMax: number;
  defaultSqFt: number;
  perSqFtAnnual: number;
}

export const PRICING_MATRIX: Record<string, PricingRule> = {
  restaurant:  { annualMin: 3000,  annualMax: 7200,  defaultSqFt: 2500,  perSqFtAnnual: 0.60 },
  office:      { annualMin: 1440,  annualMax: 3600,  defaultSqFt: 5000,  perSqFtAnnual: 0.36 },
  warehouse:   { annualMin: 4800,  annualMax: 14400, defaultSqFt: 20000, perSqFtAnnual: 0.24 },
  retail:      { annualMin: 1800,  annualMax: 4800,  defaultSqFt: 3000,  perSqFtAnnual: 0.42 },
  multifamily: { annualMin: 2400,  annualMax: 7200,  defaultSqFt: 8000,  perSqFtAnnual: 0.48 },
  residential: { annualMin: 600,   annualMax: 1800,  defaultSqFt: 1800,  perSqFtAnnual: 0.20 },
  healthcare:  { annualMin: 6000,  annualMax: 18000, defaultSqFt: 10000, perSqFtAnnual: 0.80 },
  school:      { annualMin: 3600,  annualMax: 9600,  defaultSqFt: 12000, perSqFtAnnual: 0.40 },
  hotel:       { annualMin: 4800,  annualMax: 14400, defaultSqFt: 15000, perSqFtAnnual: 0.55 },
};

const DEFAULT_RULE: PricingRule = {
  annualMin: 1440,
  annualMax: 4800,
  defaultSqFt: 3000,
  perSqFtAnnual: 0.36,
};

const TIER_POSITION: Record<string, number> = { low: 0.25, medium: 0.60, high: 1.00 };

const RISK_MULTIPLIER: Record<string, number> = {
  low:      0.85,
  medium:   1.00,
  high:     1.30,
  critical: 1.55,
};

function resolveRule(propertyType: string): PricingRule {
  const key = propertyType.toLowerCase();
  if (key in PRICING_MATRIX) return PRICING_MATRIX[key]!;
  if (/food|cafe|bar|kitchen|diner|bakery|deli|pizz|bistro|eatery/.test(key)) return PRICING_MATRIX.restaurant!;
  if (/apartment|condo|housing|unit|tenant|complex|reside|multifam/.test(key)) return PRICING_MATRIX.multifamily!;
  if (/store|shop|boutique|grocery|supermarket|market|strip.mall/.test(key)) return PRICING_MATRIX.retail!;
  if (/medical|clinic|hospital|dental|pharmacy|health|urgent.care/.test(key)) return PRICING_MATRIX.healthcare!;
  if (/school|university|college|campus|daycare|educat|k-12/.test(key)) return PRICING_MATRIX.school!;
  if (/hotel|motel|inn|lodge|airbnb|hospitality|resort/.test(key)) return PRICING_MATRIX.hotel!;
  if (/home|house|residen|single.family|sfr/.test(key)) return PRICING_MATRIX.residential!;
  if (/office|corporate|business|professional|co.work/.test(key)) return PRICING_MATRIX.office!;
  if (/warehouse|storage|distribution|logistics|industrial|fulfillment/.test(key)) return PRICING_MATRIX.warehouse!;
  return DEFAULT_RULE;
}

/** Estimated annual contract value in whole dollars (nearest $100). */
export function calculateEstimatedAnnualValue({
  propertyType,
  tier,
  riskLevel,
  squareFootage,
}: {
  propertyType: string;
  tier: "low" | "medium" | "high";
  riskLevel?: string | null;
  squareFootage?: number | null;
}): number {
  const rule = resolveRule(propertyType);
  const sqFt = squareFootage ?? rule.defaultSqFt;
  const position = TIER_POSITION[tier] ?? 0.60;
  const riskMult = RISK_MULTIPLIER[riskLevel ?? "medium"] ?? 1.0;

  const base = rule.annualMin + (rule.annualMax - rule.annualMin) * position;
  const sqFtContrib = sqFt * rule.perSqFtAnnual;
  const raw = (base + sqFtContrib) * riskMult;
  const bounded = Math.min(Math.max(raw, rule.annualMin), rule.annualMax * 2);

  return Math.round(bounded / 100) * 100;
}

/**
 * Returns a human-readable range string, e.g. "$3,600 – $5,400/yr".
 * The range is ±20% around the point estimate.
 */
export function formatEstimateRange(annualValue: number): string {
  const lo = Math.round((annualValue * 0.8) / 100) * 100;
  const hi = Math.round((annualValue * 1.2) / 100) * 100;
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n}`;
  return `${fmt(lo)} – ${fmt(hi)}/yr`;
}

// ─── Exclusion & Remediation Pricing ─────────────────────────────────────────

export type ExclusionTier = "minor" | "medium" | "major";

/** How the price estimate was derived. */
export type PriceSource = "laser" | "ai_estimate" | "tier_default";

/** Mirrors the server-side AiPrediction.measurementEstimate shape. */
export interface MeasurementEstimate {
  linearFt?: number | null;
  gapWidthIn?: number | null;
  heightFt?: number | null;
  confidence: number;
  source: "ai_vision_estimate";
}

export interface ExclusionItem {
  id: string;
  defectDescription: string;
  location: string | null;
  tier: ExclusionTier;
  /** Dollar estimate for this item. */
  estimate: number;
  /** Low end of the market range (used as floor). */
  rangeMin: number;
  /** High end of the market range (used as ceiling). */
  rangeMax: number;
  recommendedFix: string;
  /** How the estimate was computed. */
  priceSource: PriceSource;
  /** Measurement that drove the pricing, when available. */
  measurement?: {
    linearFt: number;
    source: PriceSource;
    confidence: number;
  };
  /** Per-linear-foot rate used (when measurement-based pricing applies). */
  perLinearFtRate?: number;
  /**
   * URL of the photo FAIE analyzed to produce the AI vision estimate.
   * Only present when priceSource === "ai_estimate".
   */
  photoUrl?: string | null;
}

/** Market rate ranges per exclusion tier (commercial pest control, US 2024). */
export const EXCLUSION_TIERS: Record<ExclusionTier, { min: number; max: number; label: string }> = {
  minor: { min: 150,  max: 450,  label: "Minor exclusion"    },
  medium:{ min: 300,  max: 800,  label: "Medium exclusion"   },
  major: { min: 1000, max: 3500, label: "Major remediation"  },
};

/** Keywords that indicate the work severity. Order matters — major checked first. */
const MAJOR_KEYWORDS =
  /roofline|soffit|crawlspace|foundation|trench|attic|fascia|structural|framing|subflooring|utility.shaft|sewer|drain.pit/i;
const MEDIUM_KEYWORDS =
  /door.sweep|vent.screen|pipe.chase|conduit|utility.penetrat|hvac|duct|chase|plenum|ceiling.void|wall.void/i;

/**
 * Per-linear-foot labor + material rates by exclusion tier (US commercial, 2024).
 * Applied when a measurement (laser or AI vision) provides linear footage.
 */
export const PER_LINEAR_FT_RATE: Record<ExclusionTier, number> = {
  minor:  22,  // caulk runs, gap sealing, weep-hole screens
  medium: 48,  // pipe chases, vent screens, door sweep runs
  major:  95,  // roofline sealing, soffit work, foundation trenching
};

/**
 * Classifies a structural finding into an exclusion tier and returns a
 * fully-populated ExclusionItem.
 *
 * Pricing priority (highest wins):
 *   1. laserLinearFt — exact hardware measurement, most accurate
 *   2. finding.measurementEstimate.linearFt — AI vision estimate
 *   3. Tier midpoint fallback — no measurement available
 */
export function classifyExclusionFinding(
  finding: {
    id: number;
    structuralIssue?: string | null;
    description: string;
    location?: string | null;
    treatment?: string | null;
    measurementEstimate?: MeasurementEstimate | null;
    /** Storage URL of the photo FAIE analyzed (Finding.imageUrl). */
    imageUrl?: string | null;
  },
  laserLinearFt?: number | null,
): ExclusionItem {
  const text = `${finding.structuralIssue ?? ""} ${finding.description}`;

  let tier: ExclusionTier = "minor";
  if (MAJOR_KEYWORDS.test(text)) tier = "major";
  else if (MEDIUM_KEYWORDS.test(text)) tier = "medium";

  const { min, max } = EXCLUSION_TIERS[tier];
  const rate = PER_LINEAR_FT_RATE[tier];

  const defaultFix: Record<ExclusionTier, string> = {
    minor:  "Seal with commercial-grade caulk or install weep-hole screens",
    medium: "Install door sweep / vent screen and seal utility penetration",
    major:  "Structural sealing with heavy-duty mesh, sealant, and hardware cloth",
  };

  // ── Measurement-based pricing ─────────────────────────────────────────────
  if (laserLinearFt != null && laserLinearFt > 0) {
    const raw = laserLinearFt * rate;
    const estimate = Math.max(Math.round(raw / 50) * 50, min);
    return {
      id: String(finding.id),
      defectDescription: finding.structuralIssue ?? finding.description,
      location: finding.location ?? null,
      tier,
      estimate,
      rangeMin: min,
      rangeMax: max,
      recommendedFix: finding.treatment ?? defaultFix[tier],
      priceSource: "laser",
      measurement: { linearFt: laserLinearFt, source: "laser", confidence: 1.0 },
      perLinearFtRate: rate,
    };
  }

  const aiLinearFt = finding.measurementEstimate?.linearFt;
  if (aiLinearFt != null && aiLinearFt > 0 && (finding.measurementEstimate?.confidence ?? 0) >= 0.35) {
    const raw = aiLinearFt * rate;
    const estimate = Math.max(Math.round(raw / 50) * 50, min);
    return {
      id: String(finding.id),
      defectDescription: finding.structuralIssue ?? finding.description,
      location: finding.location ?? null,
      tier,
      estimate,
      rangeMin: min,
      rangeMax: max,
      recommendedFix: finding.treatment ?? defaultFix[tier],
      priceSource: "ai_estimate",
      measurement: {
        linearFt: aiLinearFt,
        source: "ai_estimate",
        confidence: finding.measurementEstimate?.confidence ?? 0,
      },
      perLinearFtRate: rate,
      photoUrl: finding.imageUrl ?? null,
    };
  }

  // ── Tier midpoint fallback ────────────────────────────────────────────────
  return {
    id: String(finding.id),
    defectDescription: finding.structuralIssue ?? finding.description,
    location: finding.location ?? null,
    tier,
    estimate: Math.round(((min + max) / 2) / 50) * 50,
    rangeMin: min,
    rangeMax: max,
    recommendedFix: finding.treatment ?? defaultFix[tier],
    priceSource: "tier_default",
  };
}

export function formatDollar(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n}`;
}
