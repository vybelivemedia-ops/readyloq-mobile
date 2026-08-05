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
