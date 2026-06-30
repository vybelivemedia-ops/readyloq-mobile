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
- CORS is credentialed (`credentials: true`, required for cookie auth) but NOT `origin: true`. Origin is an explicit allowlist: `CORS_ALLOWED_ORIGINS` (comma-separated prod origins) plus Replit dev/preview origins that are allowed ONLY when `NODE_ENV !== "production"`. **Do NOT revert to `origin: true`** — with credentialed auth that lets any site make authenticated cross-origin reads. See app.ts.
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
- Branding: multi-profile model (see White Label section). `GET /active` + `GET /` are PUBLIC; all CRUD is manager-only (requireRole in branding.ts).
- `useCurrentUser()` hook (hooks/use-current-user.ts): fetches GET /api/auth/me, enabled only when isSignedIn, staleTime 5min.
- Role from server replaces localStorage use-role.ts toggle. View Mode card removed from settings.tsx.
- Layout.tsx uses useUser() (Clerk) for display name and useCurrentUser() for role. Sign-out via useClerk().signOut().

## Multi-Tenancy (company-scoped isolation) — CURRENT MODEL, supersedes older notes
- ReadyLoq IS multi-tenant: a `companyId` column scopes nearly every table (reports, inspections, analysis, properties, branding, callbacks, training, dataset(s), intelligence-dataset, users, companies). **Any older note calling the app "single-tenant/shared by design" or "no tenant column anywhere" is OBSOLETE — do NOT remove company scoping; cross-tenant access is a security bug, not a feature.**
- **Every authenticated route scopes reads AND writes by companyId** (`requireAuth + requireCompany`, `getCompanyId(req)`). Never trust a foreign key (e.g. `report.inspectionId`) alone — re-fetch the referenced row constrained by companyId before using it, and fail loudly if it's missing.
- Object storage is tenant-scoped: `GET /storage/objects/*` enforces `objectPathCompanyScope(path)===companyId`; uploads are keyed under `companies/{id}/`.
- Isolation is guarded by tests: `routes/isolation.test.ts`, `storage.test.ts`, `branding.test.ts`. Keep them green.

## Design Philosophy (per product vision)
- Dark mode is the DEFAULT — `:root` holds dark vars; `.light` is opt-in. `main.tsx` adds `dark` class to `document.documentElement`
- Home screen = one large "START INSPECTION" pulsing orb — NOT a stats dashboard
- Camera-centric recording experience: real getUserMedia, canvas overlay, AI detection toasts
- Voice-first: voice commands listed on setup screen, voice note button during recording, mic toggle
- AI is supportive ("Consider inspecting…" / "Potential X Detected") — NEVER grading ("you missed", "incomplete")
- Rounded-2xl cards, large touch targets, one-handed mobile UX
- Battery efficiency is a CORE product requirement — see Inspection Modes below

## Camera + Capture (inspections/new.tsx) — REAL manual capture only
- **BETA has NO simulation / auto-detection / mock data.** An inspection = real manual photo capture + real voice notes + real batched AI on completion. There is NO auto-detection loop, NO fake detection chips/bounding boxes, NO picsum fallback. Any older note describing `DETECTIONS`/`performIntelligentCapture`/`performSimpleCapture`/picsum is OBSOLETE (removed in the beta cleanup).
- `useCamera()` still manages REAL capture: getUserMedia, ImageCapture API, applyConstraints (hardware zoom/focus), manual shutter → ImageCapture.takePhoto()/canvas frame → Blob URL → uploadToStorage.
- On camera/storage failure: show an EXPLICIT error state — NEVER substitute a fake/placeholder image.
- `InspectionMode`/`MODE_CONFIG`/`useBatteryStatus()`/`suggestModeFromBattery()`/`inspectionModeRef` still exist for battery-aware UX, but they NO LONGER drive any AI detection loop (the loop and its detection intervals were removed).

## Voice Intelligence (voice-intelligence.ts + use-voice-recognition.ts)
- Full vocabulary DB: rodents/cockroaches/termites/carpenter_ants/exclusion/conducive in EN/ES/PT
- `useVoiceRecognition({ lang, onFinalResult })` — Web Speech API state machine
- Terminology suggestion overlay: shows professional term + report phrase when casual term detected
- Language selector (EN/ES/PT pills) in setup step; `inspectionLang` drives speech recognition lang

## Conventions
- All hooks: import from `@workspace/api-client-react`, never relative (WEB app only; the mobile app uses its vendored `@/lib/api-client` — see Native Mobile App)
- Hook query options pattern: `useGetThing(id, { query: { enabled: !!id } })`
- API routes registered in `artifacts/api-server/src/routes/index.ts`
- QueryClientProvider + TooltipProvider + Toaster all live in App.tsx (not main.tsx)
- Health endpoint is at `/api/healthz` (not /health)
- zod imports: use `zod/v4` (not `zod`) — matches drizzle-zod convention in codebase

## Object Storage (GCS via Replit)
- Bucket: `replit-objstore-e989ae13-7af0-4fc5-942e-57b60a6fd134`; env vars: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`
- Deps: `@google-cloud/storage` + `google-auth-library` in @workspace/api-server
- Route: `artifacts/api-server/src/routes/storage.ts` — mounted in index.ts as `router.use(storageRouter)`. The two PRIVATE routes are `requireAuth + requireCompany + requireBetaAccess`: `POST /uploads/request-url` (shared by technician photo + manager branding uploads) and `GET /objects/*` (private inspection photos/voice notes; cookie auth means same-origin <img>/fetch work for signed-in users). **`requireBetaAccess` MUST be on these private storage routes too** — otherwise a paused technician could still mint upload URLs / read private objects, bypassing the kill-switch (see Closed Beta). `GET /public-objects/*` stays fully public (logos render on the pre-sign-in login page) — never gate it. No per-object ACL check: objects carry no ACL policy metadata so canAccessObjectEntity would reject everything; tenant isolation is enforced separately by `objectPathCompanyScope(path)===companyId` (see Multi-Tenancy), NOT by a shared-data model.
- Storage.ts uses inline zod instead of `@workspace/api-zod` imports (api-zod doesn't have those types)
- Upload flow: `POST /api/storage/uploads/request-url {name,size,contentType}` → `{uploadURL,objectPath}`; PUT uploadURL with bytes; serving URL = `/api/storage${objectPath}`
- `uploadToStorage(url, filename)` helper in new.tsx: converts blob:/data: URLs to permanent GCS paths (gracefully falls back to original URL on error)

## Analysis Creation — REAL batched AI
- **`overallConfidence` canonical scale is 0–1** (column is `real`); ALL UI + analytics consumers multiply by 100 for display, so NEVER store 0–100. Both `POST /analysis` and `POST /analysis/analyze` store 0–1. **Why:** detail/report UI and analytics already assume 0–1; storing 0–100 produced "8700%" and made `/analytics/risk` (`100 - avgConf*100`) always critical.
- `POST /analysis/analyze` (requireAuth + company) is the REAL batched-AI endpoint: it ONLY analyzes photos already persisted as `inspection_media` for that inspection+company, enforces `objectPathCompanyScope(path)===companyId`, and caps real AI calls at `MAX_ANALYZE_IMAGES=40`. **Client (new.tsx handleComplete) MUST persist media BEFORE calling analyze.**
- `POST /api/analysis` (manual create) is still registered BEFORE `GET /:id` (route-conflict). Both live in analysis.ts.
- **Video evidence is captured + stored but DELIBERATELY never turned into findings.** `/analysis/analyze` accepts `videos[]`, applies the SAME tenant guards as photos PLUS a `mediaType==="video"` persisted-row check (a photo/voice URL submitted under `videos[]` is rejected), and stores each as `videoEvidence` with `frameAnalysisStatus:"pending"` — the forward hook for future per-frame analysis. It must NEVER call the vision model on video or merge video into `findings`. **Why:** product rule — video is supplementary evidence only until frame analysis ships; keep videos OUT of `images[]` client-side. Guarded by the video tests in analyze.test.ts.

## Seed Data — REMOVED
- **All seed scripts were DELETED in the beta cleanup** (seed.ts, seed-branding.ts, seed-callbacks.ts, seed-properties.ts, seed-finding-quality.ts, lib/seed-company.ts). Existing seeded DB rows were LEFT intact (tenant-scoped to the legacy company). Any older note referencing a `seed-*.ts` file is obsolete.
- (Env note, still true if a one-off script is ever needed: `tsx` is not installed; `npx tsx`/`pnpm exec tsx` fail — use `pnpm dlx tsx <file>`.)

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
- **Property routes are company-scoped** (requireAuth + requireCompany; reads/writes filter by companyId) — see Multi-Tenancy. Any older "single-tenant/shared by design" note here is OBSOLETE.
- Pre-inspection lookup: `GET /properties/lookup?siteAddress=` returns matchStatus exact|possible|none (possible = prefix or ≥50% token Jaccard on the slug). Frontend `PreInspectionIntel` (debounced 400ms, ≥4 chars) in components/property-intel.tsx, injected into inspections/new.tsx setup step.
- Seed: `seed-properties.ts` (count-guarded, idempotent) attaches profiles to the Riverside/Oak addresses that already have analyses so derived sections populate.

## Brand assets / logo
- Single brand mark for the whole app lives at `artifacts/readyloq/public/logo.png` (transparent-corner blue rounded-square "R"). Used by: favicon + apple-touch-icon (index.html via `%BASE_URL%logo.png`), in-app header marks (layout.tsx `logoSrc`), WelcomePage + Clerk `logoImageUrl` (App.tsx), and PDF cover `DEFAULT_LOGO` fallback (report-pdf.tsx).
- **Do NOT use the AI background-removal tool on clean geometric/icon art** — it mangled the rounded-square edges (jagged blobs). For a logo that is a solid shape on a flat background, process geometrically with ImageMagick instead: `-trim` the margin, then composite a white `roundrectangle` mask with `-compose DstIn` (output `PNG32:` to force the alpha channel) for crisp transparent corners.
- BASE_PATH for readyloq dev is `/` (so asset URLs resolve at root). Vite dev server runs on `$PORT` (was 20257); `%BASE_URL%` in index.html is replaced by Vite at serve time.

## White Label / Branding Profiles (multi-profile re-branding, no code changes)
- `branding_profiles` table (lib/db/src/schema/branding.ts) REPLACED the old single `branding` table — multiple saved profiles; the live one is the single row with `isActive=true`. `READYLOQ_DEFAULT_PROFILE` is the canonical default constant; one row is `isDefault=true` and protected (cannot be deleted; `restore-defaults` resets it to the constant and re-activates it).
- API (routes/branding.ts) is mounted WITHOUT a global auth guard: `GET /active` + `GET /` (PDF alias) are PUBLIC (login/landing must brand before sign-in); everything below `router.use(requireAuth, requireRole("manager"))` is manager-only CRUD (list/create/get/patch/duplicate/delete/activate + `POST /restore-defaults`). `isDefault`/`isActive` are stripped from create/patch bodies and only change via the dedicated activate/restore endpoints. Color fields validated against hex (`firstInvalidColor` → 400).
- **Runtime theming is centralized in `components/branding-provider.tsx` — it is the SINGLE place that calls `applyBrandingToDocument` (CSS vars/title/favicon), applying `effective = preview ?? active`. NEVER call applyBrandingToDocument from anywhere else — it races with the provider's active-profile refetch and gets clobbered.** Live preview goes through the `useBrandingPreview()` setter; `useBranding()` returns the effective profile so React-rendered logo/name live-update too.
- White Label Manager UI lives in `components/white-label/*` (white-label-manager, profile-editor, brand-preview, image-cropper, profile-draft). Gated in settings.tsx behind `useCurrentUser().role === "manager"` (UX only; the server enforces requireRole). PDF branding flows through `useReportPdfData` → active profile, separate from live preview.
- **Why public GET /active:** the unauthenticated login/landing/loading screens must show the active brand, so the active-profile read cannot require auth. Branding's public-read surface is the exception; data routes are company-scoped — see Multi-Tenancy.
- **Public/pre-login branding depends on a reserved company `slug="platform"`. Any code path that assumes a specific *seeded* row must self-bootstrap (create-on-demand) AND fail loud on real persistence errors — never null-fallback to a 500.** **Why:** freshly *published* DBs are NOT seeded (seed scripts were deleted) and the prod DB is read-only to the agent, so a missing seed row hard-fails in prod (this caused repeated 500s on public branding — prod `companies` had only real tenants, no `platform` row). First-time per-company profile seeding must also serialize (transaction-scoped Postgres advisory lock keyed by companyId) to preserve the one-active/one-default invariant under concurrent first requests, since there's no DDL uniqueness guard. **Self-heal fixes reach prod only after re-publish.**

## ReadyLoq Marketing Site (artifacts/readyloq-marketing)
- SEPARATE public marketing artifact from the app (artifacts/readyloq). Positioned as a **Property Intelligence & Operational Knowledge platform — NOT an AI pest-ID app.** Dev base path is `/site/`; in prod it deploys to ReadyLoq.com root while the app + API live at app.readyloq.com.
- **Two-domain split is env-driven, not hardcoded:** marketing `src/config.ts` exposes `APP_URL` (from `VITE_APP_URL`) and `apiUrl()` (from `VITE_API_URL`); both empty in dev = same proxy origin. Cross-app links/API base must go through these, never hardcoded domains.
- **Public assets (in /public) must resolve through `asset()` in config.ts (= `import.meta.env.BASE_URL` + file).** A bare root-relative `/foo.png` (img src, CSS `url()`, Tailwind `bg-[url()]`) escapes the `/site/` base and 404s. **Why:** design subagents default to root-relative paths; this silently breaks every image until prefixed.
- **Leads are platform-level: `leads` table has NO company_id** (prospects aren't tenants yet; type = demo|contact). `POST /api/leads` is mounted PUBLIC in routes/index.ts (before the requireAuth block) with its OWN tighter rate limiter (15/15min) and validates against generated `CreateLeadBody`. This is the one intentional public write path — it only writes `leadsTable`.

## Native Mobile App (artifacts/readyloq-app, Expo SDK 54)
- **The mobile app is intentionally STANDALONE / portable — it must `npm install`/`pnpm install` and build in isolation, with NO monorepo coupling.** Its package.json uses only pinned npm versions (no `workspace:`/`catalog:`), tsconfig has no project `references`, and the generated orval client is VENDORED at `lib/api-client/` (imported as `@/lib/api-client`), a copy of `lib/api-client-react/src/`. **Why:** users clone/export just this folder. **How to apply:** if `lib/api-client-react` changes, re-vendor into `lib/api-client`; keep all deps as concrete versions; never reintroduce `@workspace/*` imports here. The package name stays `@workspace/readyloq-app` only so the Replit workflow/`.replit-artifact` filter keeps working (a private scope; harmless for standalone installs).
- **Native build (`npx expo run:android`/`run:ios`) needs an app-local `.npmrc` with `node-linker=hoisted`** — pnpm's default symlinked node_modules breaks RN autolinking (Gradle/CocoaPods). This `.npmrc` is a no-op inside the Replit monorepo (node-linker is read from the workspace root in a workspace, so the live `expo start` workflow is unaffected) and only takes effect when the folder is extracted standalone. `android/`/`ios/` are CNG-generated on demand (gitignored) — never commit them. **Do NOT manually add the reanimated/worklets babel plugin:** `babel-preset-expo@54` auto-injects `react-native-worklets/plugin` when `react-native-worklets` is installed (adding it again = duplicate-plugin error). app.json must NOT hardcode a `replit.com` expo-router `origin`. Validate config without an Android SDK via `npx expo config --type introspect` + `npx expo-doctor`.
- **Android Gradle duplicate-resource merge conflicts (`:app:mergeDebugJavaResource`, e.g. duplicate `META-INF/versions/9/OSGI-INF/MANIFEST.MF` from okhttp-logging-interceptor vs jspecify) must be fixed via the `expo-build-properties` config plugin, NEVER by hand-editing `android/app/build.gradle`** (CNG overwrites it). Add `["expo-build-properties", { "android": { "packagingOptions": { "exclude": [...] } } }]` to app.json plugins (key is `exclude`, singular). The plugin writes `android.packagingOptions.excludes=<comma-list>` into `android/gradle.properties`; the Expo template build.gradle has a loop that reads that property and applies it at merge time — so the value lands in `gradle.properties`, NOT build.gradle. Verify with `npx expo prebuild -p android --no-install` then `grep packagingOptions.excludes android/gradle.properties` (then `rm -rf android`). `expo install` churns the shared monorepo node_modules and can crash the running Metro watcher (transient `ENOENT ... watch .../*_tmp_*`); restart the expo workflow after. **Why:** the okhttp 5.x logging-interceptor + jspecify duplicate manifest fails standalone Gradle builds.
- REUSES the same backend as the web app via the vendored generated hooks. Mobile-only transport: `setBaseUrl` (from `EXPO_PUBLIC_DOMAIN`) at module load + `setAuthTokenGetter(() => getToken())` in the authed layout so the bearer token is attached (no cookie jar on native). Never duplicate backend logic here.
- **Clerk `proxyUrl` is INTENTIONALLY undefined in Expo dev** — `proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined`; the var is empty in dev (Clerk hits its direct Frontend API) and only populated for prod builds by `scripts/build.js` (from `CLERK_PROXY_URL` + domain). **Do NOT add `EXPO_PUBLIC_CLERK_PROXY_URL` to the dev/start script** — the clerk-auth skill says dev has no proxy by design. A reviewer flagging this as "missing" is a false positive.
- **AI vision analysis must filter media by `mediaType === "photo"`** (never `!== "video"`) before sending `images[]` to `/analysis/analyze` — voice/other media URLs would otherwise be sent to the vision model. Same photo-only rule as the web app.
- new-inspection submit is resumable: it stores the created inspection id + uploaded URLs in refs so a retry after a mid-flight failure does not create a duplicate inspection or re-upload, and it surfaces `AnalysisResult.analysisErrors` (partial-failure Alert) instead of silently succeeding.

## PDF Report Generation (@react-pdf/renderer)
- `@react-pdf/renderer` installed in `@workspace/readyloq` (runtime dep). Vite requires `define: { global: 'globalThis' }` in vite.config.ts — do not remove this.
- Two modes: `'customer'` (Cover, Summary, Findings, Photos, Recommendations, Technician Observations, Signatures) and `'internal'` (everything + Property Intelligence, Service History, Management Insights).
- Component: `src/components/report-pdf.tsx`. Data hook: `src/hooks/use-report-pdf-data.ts`. Address normalization: `src/lib/normalize-address-key.ts`.
- Mode selector + Preview (PDFViewer in Dialog) + Download (pdf().toBlob()) are wired in `src/pages/reports/detail.tsx`.
- GET /inspections/:id returns `media[]` inline — use `mediaType === 'photo'` for evidence, `mediaType === 'voice'` for voice notes in Technician Observations.
- No Tailwind in PDF components — use `StyleSheet.create` with camelCase React-Native-style properties only.

## AI Report Narrative (generate-narrative)
- `POST /reports/:id/generate-narrative` builds a bounded prompt from the report + its company-scoped inspection + latest analysis + media (voice captions as transcripts, photo filenames/captions as evidence refs — **NO image bytes resent**, for cost/latency), does ONE json_object LLM call, and stores the result in the additive nullable `aiNarrative` jsonb column (no migration — mirrors the evidenceQuality jsonb pattern).
- **No silent fallback:** if the company-scoped inspection can't be loaded the route returns 409 and does NOT call the model or write `aiNarrative`. **Why:** the narrative must come from a real existing report+inspection — generating from partial/empty data would emit a misleading professional report.
- PDF (`report-pdf.tsx`) branches on `aiNarrative`: when present, narrative pages REPLACE the structured summary/findings/recommendations/observations pages; photo evidence + internal pages + signature always render; managerReviewNotes is internal-mode only.

## V2 Intelligence Model — Phase 1 (technician copilot)
- **Report Confidence model** = every finding shows three things: Confidence (existing `finding.confidence`), Evidence Quality, Verified status. Shared util `lib/finding-confidence.ts` (derive fns + label/class maps) + chip components in `components/finding-confidence-chips.tsx`. Rendered in analysis/detail + reports/detail.
- **Store evidenceQuality, DERIVE verificationStatus.** `evidenceQuality?: "excellent"|"good"|"fair"` is an optional jsonb field on the Finding interface (reused by analysis_results AND reports) — added to schema + openapi, regenerated clients, NO migration (jsonb). verificationStatus is ALWAYS derived (`deriveVerificationStatus` from analysis `feedbackStatus` or report `status`) — there is no per-finding write path, so deriving avoids a dual source of truth.
- **Coaching split (still a product rule):** the Confidence/Evidence/Verified chip rows are ALWAYS shown; coaching surfaces (per-finding verification suggestions) are OPTIONAL, gated by `coachingEnabled` (`hooks/use-coaching.ts`, localStorage "readyloq-coaching", default ON; toggle in settings.tsx). **OBSOLETE after beta cleanup:** the capture-quality score badge, capture tips, and `lib/capture-quality.ts` (`gradeCaptureQuality`) were REMOVED — the settings coaching toggle now ONLY gates verification-kb suggestions (relabeled "Verification Suggestions").
- **Verification suggestions** = static frontend KB (`lib/verification-kb.ts`, category→string[] checks, case-insensitive+substring lookup, generic fallback). No storage/API.
- Phase 2 (probabilistic pest ID, multi-evidence confidence) is LATER — these surfaces were designed to extend, not rebuilt.

**Why (dark default):** Field techs use ReadyLoq on phones in varied lighting — dark mode is required for the product vision.
**Why (Wouter base):** Strip trailing slash from BASE_URL to avoid double-slash routing bugs.
**Why (camera fallbacks):** Web camera APIs have inconsistent browser support; real capture falls back ImageCapture → canvas frame. On total failure show an explicit error — NO fake/placeholder image (beta has no simulation).
**Why (Battery-first):** Technicians run 8–10 hour routes; battery drain is a real field complaint. Mode selection is a first-class product decision, not a settings toggle.
**Why (cookie auth, no setAuthTokenGetter):** Web apps share origin with the API via Replit proxy — cookies are automatic. setAuthTokenGetter is only for Expo/mobile where there's no shared cookie jar.
**Why (JIT user provisioning):** Users table only stores clerkUserId + role. Email/name come from Clerk directly (useUser() hook). JIT creates the DB row on first API call with default "technician" role. Manager role must be set via direct DB update for the pilot.

## Generated hooks: queryKey is mandatory (frontend typecheck gotcha)
- orval generates the query option as `query?: UseQueryOptions<...>` (the FULL type), which under @tanstack/react-query v5 REQUIRES `queryKey`. So `{ query: { enabled: x } }` fails `tsc` with "Property 'queryKey' is missing".
- The readyloq frontend has a PRE-EXISTING baseline of these errors across many pages (dataset, analysis, inspections, reports, training, etc.) — they never surface at runtime because Vite/esbuild does not typecheck. `pnpm --filter @workspace/readyloq run typecheck` is therefore not green at baseline.
- **Convention when adding/using a generated query hook:** always pass `queryKey`, e.g. `useListThing(params, { query: { enabled, queryKey: getListThingQueryKey(params) } })`. **Why:** keeps your new code tsc-clean and cache keys correct without having to fix the whole pre-existing baseline.

## Closed Beta / Beta Center (manager/owner-gated `/beta`)
- Beta-access kill-switch lives in `requireBetaAccess` (middleware/require-auth.ts): owners/managers ALWAYS bypass (never lock out an admin); a technician with `users.betaAccess=false` gets `403 {code:"beta_access_disabled"}`. It gates ALL tenant data routes (inspections/analysis/dataset/reports/analytics/intelligence/properties **and the two private storage routes**) but is DELIBERATELY NOT on `/beta` — so a paused tester can still submit feedback / report errors. **Why:** the feedback + error channel must stay open precisely for the people having problems. The client uses `code:"beta_access_disabled"` to show a friendly paused screen.
- **Client-side failure reporter `lib/report-client-error.ts` POSTs to `/api/beta/errors`** (the real route — there is NO `/api/error-events` endpoint), best-effort/never-throw, keepalive. Used at the direct object-storage PUT + request-url failure points in branding-upload.ts / intelligence-upload.ts (those bypass the API server so server-side logErrorEvent can't see them). Truncate message to ≤500 to match the server `ClientErrorBody` schema, or the swallow-on-failure helper silently drops it.
- Checklist content is the source of truth IN CODE (`CHECKLIST` array in routes/beta.ts, 12 items); per-company completion lives in `beta_checklist_state` keyed by stable `itemKey` (rows created lazily on first toggle) so the list can evolve without orphaning state.
- `logErrorEvent(category, {...})` (lib/error-events.ts) is best-effort never-throw: wire it at failure points, never `await` it in a way that can break the request. requireRole persists company-scoped 403s as `auth` error events so the Beta Center error monitor surfaces forbidden attempts.
- Coverage: `routes/beta.test.ts` (tenant isolation, tech-can-feedback, manager-only admin 403s, kill-switch incl. private storage denial, analytics media KPIs). Keep green.

## Object-storage path: display URL vs canonical path (scope-checked endpoints)
- The upload helpers (branding-upload.ts, intelligence-upload.ts) return a DISPLAY url `/api/storage/objects/companies/{id}/uploads/...` so the browser `<img src>` resolves through the `/api/storage` mount.
- But `objectPathCompanyScope()` and `ObjectStorageService.getObjectEntityFile()` require the CANONICAL path `/objects/...` (they strip/expect a leading `/objects/`). Passing the display url straight in makes the tenant scope check read "legacy" and reject, and the byte-fetch throw.
- **Rule:** any endpoint that runs a company scope-check or reads object bytes from a client-supplied image URL must strip the `/api/storage` prefix first (see `toStoragePath()` in routes/intelligence-dataset.ts). Store the display url for rendering; normalize for scope/AI.
