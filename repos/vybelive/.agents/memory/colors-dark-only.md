---
name: VYBE LIVE dark-only color pattern
description: Both light and dark color keys use the same dark palette; app is always dark
---

VYBE LIVE enforces a dark-only UI. `artifacts/mobile/constants/colors.ts` exports both `light` and `dark` keys pointing to the same dark palette so `useColors()` works on light-mode devices without branching.

**Rule:** `colors.light === colors.dark` (same dark values). Do NOT add separate light values.

The `useColors` hook was simplified to:
```typescript
const palette = scheme === "dark" ? colors.dark : colors.light;
return { ...palette, radius: colors.radius };
```
(removed the `"dark" in colors` guard which caused a TS type error with `radius`).

**Why:** The old scaffold `useColors` assumed `colors.light` might not exist. After adding both keys, the guard became unnecessary and caused a type cast error.
