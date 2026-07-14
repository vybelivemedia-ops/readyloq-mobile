---
name: expo-router useFocusEffect import
description: useFocusEffect is in expo-router JS bundle and has its own .d.ts but is not re-exported from expo-router's main index.d.ts
---

## Rule

Import `useFocusEffect` from `"expo-router/build/useFocusEffect"`, not from `"expo-router"` or `"@react-navigation/native"`.

```typescript
import { useFocusEffect } from "expo-router/build/useFocusEffect";
```

**Why:** The expo-router package (v6.0.x) ships `useFocusEffect.d.ts` in its `build/` directory and exports the function at runtime via `build/exports.js`, but the main `index.d.ts` does not re-export it. Importing from `@react-navigation/native` fails because that package is a transitive dependency without its own type declarations in the mobile workspace.

**How to apply:** Any time `useFocusEffect` is needed for tab/screen focus detection in the mobile app.
