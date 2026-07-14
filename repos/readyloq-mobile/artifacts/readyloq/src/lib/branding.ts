import type { BrandingProfile } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Bundled ReadyLoq logo used whenever a profile has no custom logo/icon. */
export const DEFAULT_LOGO = `${basePath}/logo.png`;

/** Client-side fallback that mirrors the seeded ReadyLoq Default profile. */
export const DEFAULT_BRANDING: BrandingProfile = {
  id: 0,
  name: "ReadyLoq Default",
  isDefault: true,
  isActive: true,
  companyName: "ReadyLoq",
  tagline: "AI-Powered Inspection Intelligence",
  companyAddress: null,
  companyPhone: null,
  companyEmail: "support@readyloq.com",
  companyWebsite: "https://readyloq.com",
  licenseNumber: null,
  logoUrl: null,
  appIconUrl: null,
  primaryColor: "#0ea5e9",
  secondaryColor: "#1e293b",
  accentColor: "#06b6d4",
  reportFooterText: "Confidential Inspection Report",
  supportInfo: "support@readyloq.com",
  signatureDisclaimer: null,
  emailSenderName: "ReadyLoq",
  emailReplyTo: null,
  emailFooter: null,
  poweredByVisible: true,
  createdAt: "",
  updatedAt: "",
};

/**
 * Resolve a stored asset value for use in `<img src>`:
 * - absolute http(s)/data URLs are returned as-is
 * - already-absolute root paths (e.g. uploaded `/api/storage/...`) are returned as-is
 * - bare relative names (e.g. seeded `suburban-logo.png`) resolve against BASE_URL
 */
export function resolveAssetUrl(url: string): string {
  if (/^(https?:|data:)/i.test(url)) return url;
  if (url.startsWith("/")) return url;
  return `${basePath}/${url}`;
}

export function brandLogoSrc(b: Pick<BrandingProfile, "logoUrl">): string {
  return b.logoUrl ? resolveAssetUrl(b.logoUrl) : DEFAULT_LOGO;
}

export function brandIconSrc(b: Pick<BrandingProfile, "appIconUrl" | "logoUrl">): string {
  if (b.appIconUrl) return resolveAssetUrl(b.appIconUrl);
  if (b.logoUrl) return resolveAssetUrl(b.logoUrl);
  return DEFAULT_LOGO;
}

/** Resolve a possibly-relative asset path to an absolute URL (for Clerk / PDFs). */
export function absoluteUrl(src: string): string {
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
  return `${window.location.origin}${src.startsWith("/") ? "" : "/"}${src}`;
}

/** Parse "#rgb" / "#rrggbb" into [r,g,b] (0-255), or null when invalid. */
function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, "");
  let r: number, g: number, b: number;
  if (m.length === 3) {
    r = parseInt(m[0] + m[0], 16);
    g = parseInt(m[1] + m[1], 16);
    b = parseInt(m[2] + m[2], 16);
  } else if (m.length === 6) {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  } else {
    return null;
  }
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [r, g, b];
}

/** Convert a hex color to the "H S% L%" triplet used by the CSS theme vars. */
export function hexToHslString(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  let [r, g, b] = rgb;
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Perceived luminance 0-1, used to pick readable foreground text. */
function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Foreground triplet (near-black or white) that reads well on `hex`. */
export function readableForeground(hex: string): string {
  return luminance(hex) > 0.6 ? "0 0% 8%" : "0 0% 100%";
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Apply a branding profile to the live document: CSS theme variables, page
 * title, and favicon / apple-touch-icon. Called whenever the active profile
 * loads or changes so the entire app re-skins with no reload.
 */
export function applyBrandingToDocument(b: BrandingProfile) {
  const root = document.documentElement;

  if (b.primaryColor) {
    const primary = hexToHslString(b.primaryColor);
    if (primary) {
      for (const v of ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1"]) {
        root.style.setProperty(v, primary);
      }
      root.style.setProperty("--brand-primary", primary);
      const fg = readableForeground(b.primaryColor);
      root.style.setProperty("--primary-foreground", fg);
      root.style.setProperty("--sidebar-primary-foreground", fg);
    }
  }

  if (b.accentColor) {
    const accent = hexToHslString(b.accentColor);
    if (accent) {
      root.style.setProperty("--chart-2", accent);
      root.style.setProperty("--brand-accent", accent);
    }
  }

  if (b.secondaryColor) {
    const secondary = hexToHslString(b.secondaryColor);
    if (secondary) root.style.setProperty("--brand-secondary", secondary);
  }

  document.title = b.companyName || "ReadyLoq";

  const icon = brandIconSrc(b);
  setLink("icon", icon);
  setLink("apple-touch-icon", icon);
}
