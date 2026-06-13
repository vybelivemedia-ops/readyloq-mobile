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

## Auth Architecture (Replit-managed Clerk)
- Clerk provisioned via `setupClerkWhitelabelAuth()` — keys: CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, VITE_CLERK_PUBLISHABLE_KEY
- Web auth is **cookie-based** — DO NOT add setAuthTokenGetter, Bearer tokens, or Authorization headers to browser API calls. Cookies are automatic for same-origin fetches.
- `@clerk/express` clerkMiddleware in app.ts parses session cookies. Must come AFTER the Clerk proxy route and BEFORE body parsers.
- CORS changed from `cors()` wildcard to `cors({ credentials: true, origin: true })` (required for cookie auth).
- Clerk proxy middleware at `/api/__clerk` (production only; no-op in dev).
- `publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)` — use this pattern, never inline the env var.
- ClerkProvider must be INSIDE WouterRouter (needs useLocation) but wraps QueryClientProvider. See App.tsx.
- Sign-in/sign-up routes: `/sign-in/*?` and `/sign-up/*?` — wildcard mandatory for OAuth sub-paths.
- Appearance: `dark` theme from `@clerk/themes`, cssLayerName: "clerk", primary #0ea5e9, cardBox needs explicit bg (bg-slate-800).
- CSS layers: `@layer theme, base, clerk, components, utilities;` must come BEFORE `@import "tailwindcss"` in index.css.
- vite.config.ts: `tailwindcss({ optimize: false })` required for Clerk + Tailwind v4 CSS layer interop.

## RBAC (server-side)
- `usersTable` in lib/db/src/schema/users.ts: clerkUserId (unique), role ("technician"|"manager"). JIT-provisioned on first authenticated request.
- `requireAuth` middleware: gets auth from getAuth(req), JIT creates user row, attaches req.user.
- `requireRole("manager")` middleware: checks req.user.role, returns 403 if wrong role.
- Routes: health (public), /auth/* (public + own requireAuth in handler), all others require requireAuth.
- Intelligence routes: requireAuth + requireRole("manager") — double-gated server-side.
- Branding: GET open to all auth users, PATCH manager-only (requireRole in branding.ts) + Zod validation via insertBrandingSchema.partial().safeParse().
- `useCurrentUser()` hook (hooks/use-current-user.ts): fetches GET /api/auth/me, enabled only when isSignedIn, staleTime 5min.
- Role from server replaces localStorage use-role.ts toggle. View Mode card removed from settings.tsx.
- Layout.tsx uses useUser() (Clerk) for display name and useCurrentUser() for role. Sign-out via useClerk().signOut().

## Design Philosophy (per product vision)
- Dark mode is the DEFAULT — `:root` holds dark vars; `.light` is opt-in. `main.tsx` adds `dark` class to `document.documentElement`
- Home screen = one large "START INSPECTION" pulsing orb — NOT a stats dashboard
- Camera-centric recording experience: real getUserMedia, canvas overlay, AI detection toasts
- Voice-first: voice commands listed on setup screen, voice note button during recording, mic toggle
- AI is supportive ("Consider inspecting…" / "Potential X Detected") — NEVER grading ("you missed", "incomplete")
- Rounded-2xl cards, large touch targets, one-handed mobile UX
- Battery efficiency is a CORE product requirement — see Inspection Modes below

## Intelligent Camera System (inspections/new.tsx)
- `useCamera()` hook manages: getUserMedia, ImageCapture API, applyConstraints (zoom/focus), canvas overlay
- Camera permission states: pending / granted / denied / unavailable — gracefully falls back to simulation
- `performIntelligentCapture(detection)` async pipeline: confirm → focus → zoom → low-light → stabilize → best-frame → capture → reset
- `performSimpleCapture(detection)` — lightweight version for Standard mode: no zoom/focus, just capture
- Real frame capture: ImageCapture.takePhoto() → Blob URL, falls back to canvas.toDataURL() from video element, falls back to picsum placeholder
- Hardware zoom via `track.applyConstraints({ advanced: [{ zoom }] })` + CSS `transform: scale()` for smooth animation
- Hardware focus via `applyConstraints({ advanced: [{ focusMode }] })` + ImageCapture.setFocusDistance for macro
- Canvas overlay on `<canvas ref={overlayRef}>` draws animated detection bounding box with corner brackets + crosshair using requestAnimationFrame
- HUD badges: zoom level (monospace), focus mode (CONTINUOUS/MACRO), LOW LIGHT+ (amber), STABILIZED (blue)

## Inspection Modes (Battery-First Design)
- `InspectionMode = "low-power" | "standard" | "enhanced"` — defined in new.tsx
- `MODE_CONFIG` record maps each mode to: detection intervals, cameraAdjustments flag, colors
- **Low Power**: no AI detection loop, voice + manual capture only — safest for <30% battery
- **Standard**: AI detections every ~28–42s, `performSimpleCapture` (no zoom/focus pipeline)
- **Enhanced**: current full behavior, detections every ~9–16s, full camera adjustment pipeline
- `useBatteryStatus()` hook in `src/hooks/use-battery-status.ts` — Battery Status API with graceful fallback
- `suggestModeFromBattery()` — auto-selects mode on setup screen from live battery level
- Auto-downgrade effect: drops to Low Power with toast when battery < 20% during recording
- `inspectionModeRef` ref kept in sync with state — read inside async detection callbacks to avoid stale closure
- Recording top bar shows: timer | mode badge (changes with mode) | battery % (BatteryWarning animates when low)

## Voice Intelligence (voice-intelligence.ts + use-voice-recognition.ts)
- Full vocabulary DB: rodents/cockroaches/termites/carpenter_ants/exclusion/conducive in EN/ES/PT
- `useVoiceRecognition({ lang, onFinalResult })` — Web Speech API state machine
- Terminology suggestion overlay: shows professional term + report phrase when casual term detected
- Language selector (EN/ES/PT pills) in setup step; `inspectionLang` drives speech recognition lang

## Conventions
- All hooks: import from `@workspace/api-client-react`, never relative
- Hook query options pattern: `useGetThing(id, { query: { enabled: !!id } })`
- API routes registered in `artifacts/api-server/src/routes/index.ts`
- QueryClientProvider + TooltipProvider + Toaster all live in App.tsx (not main.tsx)
- Health endpoint is at `/api/healthz` (not /health)
- zod imports: use `zod/v4` (not `zod`) — matches drizzle-zod convention in codebase

## Object Storage (GCS via Replit)
- Bucket: `replit-objstore-e989ae13-7af0-4fc5-942e-57b60a6fd134`; env vars: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`
- Deps: `@google-cloud/storage` + `google-auth-library` in @workspace/api-server
- Route: `artifacts/api-server/src/routes/storage.ts` — mounted in index.ts as `router.use(storageRouter)` (no auth guard — presigned URL is self-securing)
- Storage.ts uses inline zod instead of `@workspace/api-zod` imports (api-zod doesn't have those types)
- Upload flow: `POST /api/storage/uploads/request-url {name,size,contentType}` → `{uploadURL,objectPath}`; PUT uploadURL with bytes; serving URL = `/api/storage${objectPath}`
- `uploadToStorage(url, filename)` helper in new.tsx: converts blob:/data: URLs to permanent GCS paths (gracefully falls back to original URL on error)

## Analysis Creation (POST /analysis)
- `POST /api/analysis` added to analysis.ts BEFORE `GET /:id` (avoid route conflict). Protected by requireAuth.
- Body: `{inspectionId, findings[], recommendations[], overallConfidence?}` — computes avgConfidence from findings if not provided
- Called automatically in `handleComplete()` after evidence uploads but before media records
- `DETECTION_CATEGORY_MAP` (id→category) and `generateRecommendations(findings)` helpers in new.tsx

## Seed Data
- **`tsx` is NOT installed — `npx tsx` fails ("tsx: not found"). Run seed scripts with `pnpm dlx tsx artifacts/api-server/src/<seed>.ts` from repo root.** (`pnpm --filter ... exec tsx` also fails.)
- Seed script: `artifacts/api-server/src/seed.ts`
- 8 inspections, 3 analysis results, 18 dataset images, 2 reports, 4 quizzes, 11 training scores seeded
- Analyses exist only on inspections Riverside Apts (Multifamily), Oak Park Restaurant, Maple Ridge HOA
- **The main seed.ts is NOT idempotent — do not re-run it on a populated DB (it duplicates).** Newer seeds (e.g. seed-callbacks.ts) are count-guarded and safe to re-run.

## ReadyLoq Command (management-only intelligence module)
- API: `artifacts/api-server/src/routes/intelligence.ts` → GET /intelligence/{opportunities,callbacks,property-risk}
- Opportunities & property-risk are DERIVED at request time from `analysis_results.findings` (NOT stored). Mapping is an explicit `CATEGORY_OPP` record + the `exclusionOpportunity` flag + a couple of text overrides (door sweep→structural, moisture regex→moisture). No category keyword fuzzing.
- "Unreported opportunity" = a finding maps to an opp type AND no recommendation string contains a matching keyword (`OPP_KEYWORDS`). Surfaced management-only. Generic words like "repair" are deliberately excluded from keywords to avoid false "documented".
- Callback data comes from the `callbacks` table (schema in lib/db/src/schema/callbacks.ts, FK→inspections), seeded by `seed-callbacks.ts` (idempotent, backdated ~6 months).
- Frontend: `src/pages/command.tsx` (recharts, matches analytics.tsx). Role now from useCurrentUser() (server), not use-role.ts localStorage.
- Gating: `/command` Route conditionally registered in App.tsx ProtectedRoutes based on isManager from useCurrentUser(). "Command" nav item added in layout.tsx based on same. Double-gated: requireAuth + requireRole("manager") on /intelligence/* server-side.

## Property Intelligence Feed (per-property knowledge, available pre-inspection)
- All property intelligence is keyed by `normalizeAddressKey(siteAddress)` (URL-safe hyphen slug) — the SAME helper used to group inspections. Read/write/derive paths MUST all key by it or profiles silently de-link from their inspections.
- **Authored** data persisted: `property_profiles` (addressKey unique, siteAddress, clientName, propertyType, technicianKnowledge, hotspots jsonb) + `property_notes` (schema in lib/db/src/schema/properties.ts). **Derived at read time** (never stored): recurringIssues, historicalPhotos, visitHistory — computed from existing inspections/analyses/media in `buildFeed`.
- Shared helper `artifacts/api-server/src/lib/property-intelligence.ts` (normalizeAddressKey/propertyTypeFor/severityRank/deriveRecurringIssues) reused by intelligence.ts AND routes/properties.ts.
- **Invariant (enforced in PATCH):** a profile's stored `siteAddress` must normalize back to its `addressKey`. PATCH rejects a body siteAddress that normalizes to a different key — otherwise address lookups would miss the profile. **Why:** the feature's whole value is matching by address before a visit.
- Hotspot severity is strictly `low|medium|high` everywhere (zod enum + OpenAPI `Hotspot.severity` enum). Frontend dropdown and defaults use these only; the generated `Hotspot` type is a union so Select onValueChange needs `v as Hotspot["severity"]`.
- **Data is single-tenant/shared by design** — like ALL ReadyLoq routes, property routes are behind requireAuth only, with NO per-user/org scoping (no tenant column anywhere). An architect may flag "no per-tenant auth" — that is the app's intentional shared-data model, NOT a bug to fix.
- Pre-inspection lookup: `GET /properties/lookup?siteAddress=` returns matchStatus exact|possible|none (possible = prefix or ≥50% token Jaccard on the slug). Frontend `PreInspectionIntel` (debounced 400ms, ≥4 chars) in components/property-intel.tsx, injected into inspections/new.tsx setup step.
- Seed: `seed-properties.ts` (count-guarded, idempotent) attaches profiles to the Riverside/Oak addresses that already have analyses so derived sections populate.

## V2 Intelligence Model — Phase 1 (technician copilot)
- **Report Confidence model** = every finding shows three things: Confidence (existing `finding.confidence`), Evidence Quality, Verified status. Shared util `lib/finding-confidence.ts` (derive fns + label/class maps) + chip components in `components/finding-confidence-chips.tsx`. Rendered in analysis/detail + reports/detail.
- **Store evidenceQuality, DERIVE verificationStatus.** `evidenceQuality?: "excellent"|"good"|"fair"` is an optional jsonb field on the Finding interface (reused by analysis_results AND reports) — added to schema + openapi, regenerated clients, NO migration (jsonb). verificationStatus is ALWAYS derived (`deriveVerificationStatus` from analysis `feedbackStatus` or report `status`) — there is no per-finding write path, so deriving avoids a dual source of truth.
- **Always-shown vs coaching-gated split (a HARD product rule):** documentation-quality surfaces (the capture score badge + the Confidence/Evidence/Verified chip rows) are ALWAYS shown. Coaching surfaces (capture tips, per-finding verification suggestions, the Retake button) are OPTIONAL, gated by `coachingEnabled`. Hook `hooks/use-coaching.ts` mirrors use-role.ts (useSyncExternalStore over localStorage "readyloq-coaching", default ON); toggle in settings.tsx.
- **Verification suggestions** = static frontend KB (`lib/verification-kb.ts`, category→string[] checks, case-insensitive+substring lookup, generic fallback). No storage/API.
- **Evidence quality at capture** = pure heuristic `lib/capture-quality.ts` `gradeCaptureQuality({confidence,lowLight,stabilized,intelligent})`. Computed inside performIntelligentCapture/performSimpleCapture (they now return `{url,quality,tips}`). Inline score badge always shown during recording; tips+Retake gated. Retake works ONLY during recording (camera live; stops at review) — review shows a read-only chip. `adjustingRef` guards BOTH retake and the auto-detection timer callback so capture pipelines never overlap.
- **Capture grade persistence:** live inspections create media only (never findings), so the grade is persisted into the media `caption` as `"<label> · evidence:<quality>"`. Write-only for now; Phase 2 needs a parser/structured field if media-level grades must be read back.
- **Backfill:** `artifacts/api-server/src/seed-finding-quality.ts` — idempotent (skip-if-present), deterministic hash of category+description, INTENTIONALLY decorrelated from confidence (high confidence + only "fair" evidence is the exact story the model surfaces). Run once with tsx; never re-run seed.ts.
- Phase 2 (probabilistic pest ID, multi-evidence confidence) is LATER — these surfaces were designed to extend, not rebuilt.

**Why (dark default):** Field techs use ReadyLoq on phones in varied lighting — dark mode is required for the product vision.
**Why (Wouter base):** Strip trailing slash from BASE_URL to avoid double-slash routing bugs.
**Why (camera fallbacks):** Web camera APIs have inconsistent browser support; ImageCapture → canvas → picsum ensures the app always works.
**Why (inspectionModeRef):** The AI detection loop is a recursive async setTimeout closure — React state is stale inside it. Always read `inspectionModeRef.current`, not the `inspectionMode` state, from inside that loop.
**Why (Battery-first):** Technicians run 8–10 hour routes; battery drain is a real field complaint. Mode selection is a first-class product decision, not a settings toggle.
**Why (cookie auth, no setAuthTokenGetter):** Web apps share origin with the API via Replit proxy — cookies are automatic. setAuthTokenGetter is only for Expo/mobile where there's no shared cookie jar.
**Why (JIT user provisioning):** Users table only stores clerkUserId + role. Email/name come from Clerk directly (useUser() hook). JIT creates the DB row on first API call with default "technician" role. Manager role must be set via direct DB update for the pilot.
