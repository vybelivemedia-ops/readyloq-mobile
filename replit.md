# ReadyLoq

ReadyLoq is an **AI inspection assistant for field pest-control technicians** — not a
digital inspection form. The AI observes, guides, documents, and assists the
technician throughout a live inspection so the report largely writes itself.

## Product vision (north star — preserve this)

ReadyLoq is an AI inspection assistant, **not just a digital inspection form**. Every
feature must help the technician in the field. The highest-priority field-technician
capabilities, in priority order, are:

1. **Continuous Live AI Inspection** — live detections while walking, continuous AI
   state updates, no page refreshes.
2. **Automatic Evidence Capture** — detect, score, and capture evidence
   automatically; blur detection, duplicate filtering, confidence scoring.
3. **Continuous Voice Narration** — hands-free voice recording, automatic
   transcription, automatic language detection, translation into the company's
   preferred language, AI-generated professional service notes, narration
   associated with photos, locations, and findings.
4. **AI Guidance Engine** — tell the technician what to inspect next; identify
   missing evidence, missed rooms; recommend follow-up actions.
5. **Inspection Memory** — compare with previous visits; highlight missing bait
   stations, previously active areas not inspected, and previous recommendations.
6. **Hardware Abstraction** — the inspection engine accepts any capture source
   (phone camera, Meta Ray-Ban smart glasses, USB camera, Wi-Fi camera, other
   wearables) without changing the AI pipeline. **Do not implement hardware
   integration unless required** — keep the abstraction ready so a new source
   plugs in cleanly.
7. **AI Measurement Mode** — estimate dimensions of holes, gaps, cracks, vents,
   windows, and exclusion points; recommend materials, quantities, and labor
   estimates.
8. **Technician-First Design** — every new feature must reduce typing, waiting,
   screen changes, and manual report writing.

**Prioritization rule:** if a proposed feature does not improve the field
inspection experience, deprioritize it behind the capabilities above. Dashboards,
settings pages, analytics, and administrative features come *after* these pillars.

## Repo map (artifacts)

- `artifacts/readyloq-app` — the REAL Expo (SDK 54) mobile app for technicians.
- `artifacts/api-server` — Express API + AI analysis pipeline.
- `artifacts/readyloq` — React web app.
- `artifacts/readyloq-marketing` — marketing site (ReadyLoq.com).
- `readyloq-mobile/` — decoy skeleton, **ignore**.

## Vision Platform (camera abstraction)

`artifacts/readyloq-app/lib/vision` is the source-agnostic capture layer for pillar 6:

- `types.ts` — universal contracts: `EvidenceItem` (never change its shape lightly),
  the capability model (`CaptureMode` = request_response | session_stream |
  async_push), and the provider interfaces + `EvidenceIntake` sink.
- `provider-registry.ts` — runtime registry. Sources are `CaptureProviderDefinition`s
  (metadata + `probe()` + `create()`). The capture screen resolves providers here
  instead of hardcoding constructors.
- `native-camera-provider.ts`, `media-import-provider.ts` — Tier 1 sources (shipping).
- `future-source-providers.ts` — reserved smart-glasses / USB / Wi-Fi / wearable
  definitions (metadata only; `probe` = unavailable, `create` throws). **Adding a
  real camera = replace one definition's `probe`/`create`; nothing downstream of
  `EvidenceItem` changes.**

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/readyloq-app run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/Zod from OpenAPI
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54 (React Native), Expo Router, Clerk auth
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Architecture decisions

- **Local-first capture:** evidence is persisted on-device immediately, then synced;
  the app is fully usable offline in the field.
- **Batched, real-capture AI (beta):** analysis runs on real evidence with 0–1
  confidence scores; no simulated detections.
- **Source-agnostic pipeline:** all capture sources funnel through `EvidenceItem`
  into one persist → sync → analyze path (see Vision Platform above).

## User preferences

- Preserve the product vision above; keep ReadyLoq an AI assistant, not a form.
- Deprioritize dashboards/settings/analytics/admin behind the 8 pillars.
- For hardware: build the abstraction, do **not** integrate real devices unless asked.

## Gotchas

- `readyloq-mobile/` is a decoy — the real app is `artifacts/readyloq-app`.

## Developer setup

### GitHub token (GH_TOKEN)

Store a **classic Personal Access Token** in the `GH_TOKEN` secret with exactly these two scopes — no more:

| Scope | Why |
|---|---|
| `repo` | Read/write access to private repositories (push, pull, clone) |
| `workflow` | Update GitHub Actions workflow files |

To generate one: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic). Check only `repo` and `workflow`, then paste the value into the `GH_TOKEN` Replit secret. Rotate the token when it expires and keep the scopes the same.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
