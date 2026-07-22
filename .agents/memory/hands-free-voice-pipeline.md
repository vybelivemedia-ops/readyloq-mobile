---
name: Hands-free voice pipeline
description: FAIE event dispatch order, new hooks/components, and voice field routing added in Prompt 4
---

## FAIE AUTO_COMMIT dispatch order (new-inspection.tsx)
Events from AudioSessionManager are routed in this priority:
1. `event.capturePhoto` → call `takePhoto()`, haptic, no notes append
2. `event.targetField === "clientName"` + `fieldValue` → `setClientName(fieldValue)` + TTS
3. `event.targetField === "siteAddress"` + `fieldValue` → `setSiteAddress(fieldValue)` + TTS
4. `event.targetField === "baitStation"` OR `(action=placed/applied && product)` →
   `addBaitStation({ label, locationType, status:"active", notes:severity })` + haptic + TTS
5. `event.pest` matched in `PEST_TYPES` → `setPestTypes(prev => [...prev, match])` + haptic
6. fallback → `setNotes(prev => prev + "\n" + line)` where line includes `[severity]` tag if present

`confirmFaieEvent` mirrors the same routing for low-confidence "Log it" taps.

**Why this order:** capture triggers are highest priority (instant feedback); field routing prevents values landing in notes; bait station auto-log is the next most structured data type; pest chip auto-select is passive (falls through to notes); notes append is always the safe fallback.

## New hooks and components
- `hooks/useVoiceField.ts` — wraps `speechService.startDictation`, returns `{ isDictating, isTranscribing, toggle }`. Mount once per field; cleanup on unmount.
- `components/VoiceMicButton.tsx` — 3-state mic button (idle / recording pulsing / transcribing spinner). Pass `size` prop to embed inline with any label row.

## Vocabulary expansions (VocabularyRegistry.ts)
- `severity` map: 4 levels (low/medium/high/critical), each with synonym list
- `captureCommands`: "take a photo", "snap", "capture", "picture", etc.
- `baitStationTriggers`: "bait station", "place bait", "station here", etc.
- `fieldPrefixes`: prefix phrases for clientName / siteAddress / notes fields
- Spanish pest aliases: cucarachas, ratones, moscas, hormigas, chinches, pulgas, avispas

## InspectionCommandParser additions
- `detectSeverity(text)` — scans severity vocab, returns canonical level (critical first, fallback)
- `detectCaptureCommand(text)` — returns true if any captureCommand found
- `detectFieldPrefix(lower, original)` — longest-match-first scan of fieldPrefixes, falls back to baitStationTrigger check

## Setup form voice buttons
Site address and Client name fields each have a `VoiceMicButton` in their label row (hidden when inspection is locked). Notes field had its own dictation button already.
