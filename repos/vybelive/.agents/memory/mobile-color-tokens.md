---
name: Mobile color tokens
description: The correct color token names from useColors() in the VYBE LIVE mobile app.
---

## Rule
Use these token names from `useColors()` — not intuitive aliases.

**Correct names (from `constants/colors.ts`):**
- `foreground` — primary text (not `text`)
- `mutedForeground` — secondary/placeholder text (not `textSecondary`, not `secondaryText`)
- `input` — input field background (not `surface`)
- `background` — screen background
- `border` — border / divider color
- `primary` — accent/brand color
- `card` — card background
- `cardForeground` — text on cards

**Why:** The token names follow a shadcn/Radix-style convention that differs from what you'd expect in a typical React Native design system.

**How to apply:** When writing new screens, check existing screens (e.g. `app/(auth)/login.tsx`) to verify token names before using `colors.X`.
