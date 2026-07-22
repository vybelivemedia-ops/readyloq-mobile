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
export {};
