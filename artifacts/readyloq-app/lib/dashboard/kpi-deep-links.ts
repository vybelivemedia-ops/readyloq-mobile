/**
 * KPI tile deep-link routes for the Executive Dashboard.
 *
 * Exported so tests can directly assert that each tile's label maps to the
 * correct filter destination — preventing silent label/route drift in future
 * refactors without a failing test.
 */

/** The filter value appended to /reports-detail for each KPI tile. */
export const KPI_DEEP_LINK_FILTERS = {
  /** "Open Pipeline" KPI — shows reports with open opportunities. */
  openPipeline: "pipeline",
  /** "Avg Quality Score" KPI — low scores correlate with critical-risk findings. */
  avgQualityScore: "critical",
  /** "Critical Risk Sites" KPI — shows reports flagged as critical risk. */
  criticalRiskSites: "critical",
} as const;

export type KpiDeepLinkFilter = typeof KPI_DEEP_LINK_FILTERS[keyof typeof KPI_DEEP_LINK_FILTERS];
