/**
 * Client-side dashboard metrics computed from the locally cached opportunities
 * list, replacing server-side aggregation for the owner home screen KPI strip.
 */

export function getDashboardMetrics(reportsList: Array<{ pipelineValue?: number }>) {
  const totalPipelineValue = reportsList.reduce((sum, report) => {
    return sum + (report.pipelineValue || 0);
  }, 0);

  return {
    pipelineValueFormatted: `$${totalPipelineValue.toLocaleString()}`,
    openOpportunitiesCount: reportsList.length,
  };
}
