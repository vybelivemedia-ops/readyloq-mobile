/**
 * @platform/ui-core
 *
 * Shared UI primitives — design tokens, component contracts, and cross-platform
 * type definitions for use by ReadyLoq, VYBE LIVE, and any future product.
 *
 * CANONICAL SOURCES:
 *   Both apps share the same shadcn/ui component set on web. ReadyLoq mobile
 *   has a custom native component library. This package unifies their contracts.
 *
 *   Web components (shadcn/ui + Tailwind):
 *     repos/readyloq-mobile/artifacts/readyloq/src/components/ui/
 *       badge.tsx, button.tsx, card.tsx, ... (full shadcn set)
 *     repos/vybelive/artifacts/marketing/src/components/ui/
 *       badge.tsx, button.tsx, card.tsx, ... (identical shadcn set)
 *
 *   Native components (React Native / Expo):
 *     repos/readyloq-mobile/artifacts/readyloq-app/components/
 *       Badge.tsx, Button.tsx, Card.tsx, EmptyState.tsx, LoadingSpinner.tsx
 *     repos/vybelive/artifacts/mobile/components/
 *       (similar native component set for VYBE mobile)
 *
 * WHAT GOES IN THIS PACKAGE:
 *   - Design tokens (color palette, spacing scale, type scale)
 *   - Component prop interfaces (platform-agnostic — no JSX)
 *   - Variant type unions (ButtonVariant, BadgeVariant, etc.)
 *   - Theme configuration type
 *
 * WHAT STAYS IN EACH APP:
 *   - Actual JSX implementations (web vs. native)
 *   - Tailwind class names (web only)
 *   - React Native StyleSheet (native only)
 *   - shadcn/ui configuration
 *
 * DEPENDENCY GRAPH:
 *   ui-core → shared-types  (for any domain primitives used in component props)
 *   All app packages may depend on ui-core
 *   ui-core must NOT depend on camera-core, streaming-core, etc.
 */

// ─── Design tokens ────────────────────────────────────────────────────────────

/**
 * Semantic color roles. Both apps use a slate/neutral base with a blue
 * primary (ReadyLoq) and a purple/blue primary (VYBE). The token names are
 * shared; the resolved values differ per theme.
 */
export interface ColorTokens {
  // Backgrounds
  background: string;
  backgroundSubtle: string;
  backgroundMuted: string;
  // Foregrounds
  foreground: string;
  foregroundMuted: string;
  foregroundSubtle: string;
  // Brand
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  // Semantic
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  danger: string;
  dangerForeground: string;
  info: string;
  infoForeground: string;
  // Borders
  border: string;
  borderStrong: string;
  // Surface
  card: string;
  cardForeground: string;
  overlay: string;
}

/**
 * Spacing scale (in logical pixels / rem units).
 * Based on a 4px base unit — consistent with Tailwind's default scale.
 */
export interface SpacingTokens {
  xs: number;   // 4px
  sm: number;   // 8px
  md: number;   // 16px
  lg: number;   // 24px
  xl: number;   // 32px
  "2xl": number; // 48px
  "3xl": number; // 64px
}

/**
 * Typography scale. Font sizes in sp (React Native) / rem (web).
 */
export interface TypeTokens {
  xs: number;
  sm: number;
  base: number;
  lg: number;
  xl: number;
  "2xl": number;
  "3xl": number;
  "4xl": number;
}

export interface Theme {
  name: string;
  colors: ColorTokens;
  spacing: SpacingTokens;
  type: TypeTokens;
  /** Border radius in px. */
  radius: { sm: number; md: number; lg: number; full: number };
}

// ─── Component variant types ──────────────────────────────────────────────────

export type ButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "link";

export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Icon placed before the label. Platform renders it; type is string (icon name) or ReactNode. */
  leadingIcon?: unknown;
  trailingIcon?: unknown;
}

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "outline";

export interface BadgeProps {
  variant?: BadgeVariant;
  label: string;
}

export interface CardProps {
  /** Applies an elevated shadow. */
  elevated?: boolean;
  /** Shows a coloured left border (semantic colour). */
  accent?: keyof Pick<ColorTokens, "primary" | "success" | "warning" | "danger" | "info">;
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Action button label. */
  actionLabel?: string;
  /** Icon identifier (platform-specific rendering). */
  icon?: string;
}

// ─── Loading / error ──────────────────────────────────────────────────────────

export interface LoadingProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export interface ErrorStateProps {
  message: string;
  /** If provided, renders a retry button. */
  onRetry?: () => void;
  retryLabel?: string;
}

// ─── Navigation / routing (cross-platform contract) ──────────────────────────

/**
 * Minimal navigation type understood by both expo-router (ReadyLoq / VYBE
 * mobile) and React Router / Wouter (ReadyLoq / VYBE web).
 */
export interface NavigationTarget {
  /** Route path or screen name. */
  to: string;
  /** Query or route params. */
  params?: Record<string, string | number | boolean>;
  /** If true, replace current history entry instead of pushing. */
  replace?: boolean;
}
