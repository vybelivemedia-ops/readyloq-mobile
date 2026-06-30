/**
 * Semantic design tokens for the ReadyLoq mobile app.
 *
 * Dark-first technician UI. The palette is derived from the web artifact's
 * brand (primary cyan #17c4d3 on a deep navy/charcoal surface). Both `light`
 * and `dark` keys intentionally use the same dark palette so the field app
 * always renders in its high-contrast dark theme regardless of the device's
 * appearance setting (technicians work in dim crawlspaces and bright sun).
 */

const palette = {
  // Legacy aliases (kept for backward compatibility with scaffold components)
  text: "#e6edf3",
  tint: "#17c4d3",

  // Core surfaces
  background: "#0d1117",
  foreground: "#e6edf3",

  // Cards / elevated surfaces
  card: "#161b22",
  cardForeground: "#e6edf3",

  // Primary action color (buttons, links, active states)
  primary: "#17c4d3",
  primaryForeground: "#04181b",

  // Secondary / less-emphasis interactive surfaces
  secondary: "#21262d",
  secondaryForeground: "#e6edf3",

  // Muted / subdued elements (dividers, timestamps, placeholders)
  muted: "#1c2128",
  mutedForeground: "#8b949e",

  // Accent highlights (badges, selected items, focus rings)
  accent: "#10282c",
  accentForeground: "#17c4d3",

  // Destructive actions (delete, error states)
  destructive: "#f85149",
  destructiveForeground: "#ffffff",

  // Status colors (severity / risk)
  success: "#3fb950",
  warning: "#d29922",
  info: "#58a6ff",

  // Borders and input outlines
  border: "#2d333b",
  input: "#2d333b",
} as const;

const colors = {
  light: palette,
  dark: palette,

  // Border radius (in px). Cards, buttons, inputs, and modals.
  radius: 12,
};

export default colors;
