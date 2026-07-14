---
name: completeWithFallback return type
description: completeWithFallback returns AIResponse, not a raw string/object — callers must read .parsed and check .fromFallback
---

## Rule

`completeWithFallback(request)` returns `Promise<AIResponse>`, where:
- `response.parsed` — already-parsed `Record<string, unknown>` (set when `responseFormat: "json"` and the call succeeded)
- `response.fromFallback` — `true` when MockProvider answered (no real AI available or quota exhausted)
- `response.text` — raw string response

Never do `typeof raw === "string" ? JSON.parse(raw) : raw` on the return value — it is not a string.

## Correct pattern

```typescript
const response = await completeWithFallback({ ..., responseFormat: "json" });
if (response.fromFallback || !response.parsed) {
  throw new Error("AI unavailable");
}
// response.parsed is Record<string, unknown>
const topLevel = response.parsed;
```

For token accounting, read directly from the response:
```typescript
const promptTokens = response.usage?.promptTokens ?? 0;
const completionTokens = response.usage?.completionTokens ?? 0;
```

**Why:** The OpenAIProvider already calls `JSON.parse()` internally when `responseFormat: "json"` (see `OpenAIProvider.ts` lines 94-101). Wrapping the return in another `JSON.parse()` either no-ops (if it's already an object) or throws. The `fromFallback` guard is the correct way to detect MockProvider answers.

**How to apply:** Any service calling `completeWithFallback` with `responseFormat: "json"` — check `.fromFallback`, read `.parsed` directly. Do not separately query `ai_usage_log` for tokens; `response.usage` has them.
