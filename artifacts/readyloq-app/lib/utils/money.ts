/**
 * Shared money formatter for compact display of dollar amounts.
 *
 * `n` is always a whole-dollar value (not cents).
 * Renders as "$1.2M", "$450K", or "$85" — no decimals below 1M except for
 * the millions tier which uses one decimal place for precision.
 */
export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}
