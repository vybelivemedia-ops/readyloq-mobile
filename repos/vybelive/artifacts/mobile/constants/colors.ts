const darkPalette = {
  // Core surfaces
  background: "#09090F",
  foreground: "#F0F0FF",
  surface: "#0E0E18",
  card: "#111119",
  cardForeground: "#F0F0FF",
  primary: "#7B61FF",
  primaryForeground: "#FFFFFF",
  secondary: "#1A1A2A",
  secondaryForeground: "#A0A0C8",
  muted: "#16161F",
  mutedForeground: "#5C5C7A",
  accent: "#FF3B6C",
  accentForeground: "#FFFFFF",
  destructive: "#FF453A",
  destructiveForeground: "#FFFFFF",
  border: "#1F1F32",
  input: "#1A1A2A",
  tint: "#7B61FF",
  text: "#F0F0FF",
  live: "#FF3B6C",
  liveGlow: "rgba(255, 59, 108, 0.25)",
  purple: "#7B61FF",
  purpleGlow: "rgba(123, 97, 255, 0.25)",
  cyan: "#00D4FF",
  cyanGlow: "rgba(0, 212, 255, 0.15)",
  neonGreen: "#39FF14",
  neonGreenGlow: "rgba(57, 255, 20, 0.2)",
  gold: "#FFD700",
  overlay: "rgba(9, 9, 15, 0.85)",
  overlayLight: "rgba(9, 9, 15, 0.5)",
};

const colors = {
  // Both light and dark use the same dark palette — VYBE LIVE is always dark
  light: darkPalette,
  dark: {
    // Core surfaces
    background: "#09090F",
    foreground: "#F0F0FF",
    surface: "#0E0E18",

    // Cards / elevated surfaces
    card: "#111119",
    cardForeground: "#F0F0FF",

    // Primary action — electric purple
    primary: "#7B61FF",
    primaryForeground: "#FFFFFF",

    // Secondary surfaces
    secondary: "#1A1A2A",
    secondaryForeground: "#A0A0C8",

    // Muted / subdued elements
    muted: "#16161F",
    mutedForeground: "#5C5C7A",

    // Accent — hot pink/red for LIVE indicators
    accent: "#FF3B6C",
    accentForeground: "#FFFFFF",

    // Destructive actions
    destructive: "#FF453A",
    destructiveForeground: "#FFFFFF",

    // Borders and inputs
    border: "#1F1F32",
    input: "#1A1A2A",

    // Legacy
    tint: "#7B61FF",
    text: "#F0F0FF",

    // VYBE specific brand tokens
    live: "#FF3B6C",
    liveGlow: "rgba(255, 59, 108, 0.25)",
    purple: "#7B61FF",
    purpleGlow: "rgba(123, 97, 255, 0.25)",
    cyan: "#00D4FF",
    cyanGlow: "rgba(0, 212, 255, 0.15)",
    neonGreen: "#39FF14",
    neonGreenGlow: "rgba(57, 255, 20, 0.2)",
    gold: "#FFD700",
    overlay: "rgba(9, 9, 15, 0.85)",
    overlayLight: "rgba(9, 9, 15, 0.5)",
  },
  radius: 14,
};


export default colors;
