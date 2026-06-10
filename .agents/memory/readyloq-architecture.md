---
name: ReadyLoq Architecture
description: Key architecture decisions and conventions for the ReadyLoq inspection platform
---

## Stack
- React + Vite (artifacts/readyloq), port 20257, previewPath "/"
- Express API server (artifacts/api-server), port 8080
- Drizzle ORM + PostgreSQL (lib/db)
- TanStack Query hooks from @workspace/api-client-react (generated via orval)
- Wouter routing with `<Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>` wrapper in App.tsx
- Tailwind CSS + shadcn/ui, teal/cyan primary (--primary: 185 80% 46%)

## Design Philosophy (per product vision)
- Dark mode is the DEFAULT — `:root` holds dark vars; `.light` is opt-in. `main.tsx` adds `dark` class to `document.documentElement`
- Home screen = one large "START INSPECTION" pulsing orb — NOT a stats dashboard
- Camera-centric recording experience: real getUserMedia, canvas overlay, AI detection toasts
- Voice-first: voice commands listed on setup screen, voice note button during recording, mic toggle
- AI is supportive ("Consider inspecting…" / "Potential X Detected") — NEVER grading ("you missed", "incomplete")
- Rounded-2xl cards, large touch targets, one-handed mobile UX

## Intelligent Camera System (inspections/new.tsx)
- `useCamera()` hook manages: getUserMedia, ImageCapture API, applyConstraints (zoom/focus), canvas overlay
- Camera permission states: pending / granted / denied / unavailable — gracefully falls back to simulation
- `performIntelligentCapture(detection)` async pipeline: confirm → focus → zoom → low-light → stabilize → best-frame → capture → reset
- Real frame capture: ImageCapture.takePhoto() → Blob URL, falls back to canvas.toDataURL() from video element, falls back to picsum placeholder
- Hardware zoom via `track.applyConstraints({ advanced: [{ zoom }] })` + CSS `transform: scale()` for smooth animation
- Hardware focus via `applyConstraints({ advanced: [{ focusMode }] })` + ImageCapture.setFocusDistance for macro
- Canvas overlay on `<canvas ref={overlayRef}>` draws animated detection bounding box with corner brackets + crosshair using requestAnimationFrame
- HUD badges: zoom level (monospace), focus mode (CONTINUOUS/MACRO), LOW LIGHT+ (amber), STABILIZED (blue)
- Adjustment phase shown in status bar above detections: "Adjusting focus…" / "Zooming 2.8×" / "Evidence saved ✓"

## Conventions
- All hooks: import from `@workspace/api-client-react`, never relative
- Hook query options pattern: `useGetThing(id, { query: { enabled: !!id } })`
- API routes registered in `artifacts/api-server/src/routes/index.ts`
- QueryClientProvider + TooltipProvider + Toaster all live in App.tsx (not main.tsx)

## Seed Data
- Seed script: `artifacts/api-server/src/seed.ts` — run with `npx tsx artifacts/api-server/src/seed.ts`
- 8 inspections, 3 analysis results, 18 dataset images, 2 reports, 4 quizzes, 11 training scores seeded

**Why (dark default):** Field techs use ReadyLoq on phones in varied lighting — dark mode is required for the product vision.
**Why (Wouter base):** Strip trailing slash from BASE_URL to avoid double-slash routing bugs.
**Why (camera fallbacks):** Web camera APIs have inconsistent browser support; ImageCapture → canvas → picsum ensures the app always works.
