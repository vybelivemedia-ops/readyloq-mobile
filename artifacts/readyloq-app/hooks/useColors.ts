import colors from "@/constants/colors";

/**
 * Returns the ReadyLoq design tokens.
 *
 * The field app is intentionally dark-first: both palettes in
 * constants/colors.ts are identical, so we always return the dark palette
 * regardless of the device appearance setting. Technicians work in dim
 * crawlspaces and bright sun, so a single high-contrast theme is the goal.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
