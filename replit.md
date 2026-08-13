# ReadyLoq

ReadyLoq is an **AI-powered field inspection platform for pest-control technicians, operators, and enterprise owners** — not a digital form. The AI observes, guides, documents, and assists throughout a live inspection so the report largely writes itself, while management gets real-time quality signals, financial pipeline visibility, and compliance enforcement without touching the field workflow.

> **Beta status:** Closed beta is showing strong early signals. Platform is being hardened for production builds. All core feature pillars are implemented and live.

---

## Product vision (north star — preserve this)

ReadyLoq is an AI inspection assistant, **not just a digital inspection form**. Every feature must help the technician in the field. The highest-priority field-technician capabilities, in priority order, are:

1. **Continuous Live AI Inspection** — live detections while walking, continuous AI state updates, no page refreshes.
2. **Automatic Evidence Capture** — detect, score, and capture evidence automatically; blur detection, duplicate filtering, confidence scoring.
3. **Continuous Voice Narration** — hands-free voice recording, automatic transcription, automatic language detection, AI-generated professional service notes, narration associated with photos, locations, and findings.
4. **AI Guidance Engine** — tell the technician what to inspect next; identify missing evidence, missed rooms; recommend follow-up actions.
5. **Inspection Memory** — compare with previous visits; highlight missing bait stations, previously active areas not inspected, and previous recommendations.
6. **Hardware Abstraction** — the inspection engine accepts any capture source (phone camera, Meta Ray-Ban smart glasses, USB camera, Wi-Fi camera, BLE wearables) without changing the AI pipeline.
7. **AI Measurement Mode** — estimate dimensions of holes, gaps, cracks, vents, windows, and exclusion points; recommend materials, quantities, and labor estimates.
8. **Technician-First Design** — every new feature must reduce typing, waiting, screen changes, and manual report writing.

**Prioritization rule:** if a proposed feature does not improve the field inspection experience, deprioritize it behind the capabilities above. Dashboards, settings pages, analytics, and administrative features come *after* these pillars.

---

## Implemented feature surface (beta-complete)

### Field technician layer
| Feature | Status | Notes |
|---|---|---|
| Live AI Inspection (FAIE) | ✅ Live | Real evidence, 0–1 confidence, batched Gemini AI |
| Hands-free Voice Narration | ✅ Live | Whisper.rn offline transcription + structured field routing |
| AI Co-Pilot HUD (split-screen) | ✅ Live | 50/50 camera + insights pane on tablets/foldables |
| Smart Guidance Engine | ✅ Live | Zone coverage, missing evidence, memory-grounded priorities |
| Property Memory | ✅ Live | Prior-visit cross-reference, historical pests, zone highlights |
| Bait Station Persistence | ✅ Live | Add/edit/sync bait stations per inspection |
| Offline-first local capture | ✅ Live | All evidence saved on-device; auto-sync on reconnect |
| Photo retry / auto-sync | ✅ Live | Failed uploads retry automatically |
| Evidence zoom / quality gate | ✅ Live | Blur detection, retake prompts |
| AI finding review & correction | ✅ Live | Inline correction modal on every AI finding |

### Hardware & device layer
| Feature | Status | Notes |
|---|---|---|
| Native camera (Expo) | ✅ Live | Primary capture source |
| Meta Ray-Ban glasses (webhook) | ✅ Live | Live AI, full-screen viewer, zoom chip |
| BLE smart glasses (GATT) | ✅ Live | Frame-chunk protocol, react-native-ble-plx |
| Wi-Fi camera capture | ✅ Live | HTTP still-capture, WifiCameraModal |
| BLE sensor adapters | ✅ Live | Temperature, CO₂, acoustic, humidity, pressure |
| Native camera health badge | ✅ Live | DeviceHealthStrip in capture UI |

### Management & operations layer
| Feature | Status | Notes |
|---|---|---|
| Mission Control Dashboard | ✅ Live | Owner toggle: KPIs, agent roster, risk alerts |
| Streamlined View | ✅ Live | Start Inspection + Quinn AI for solo/field operators |
| Owner Briefing | ✅ Live | Daily digest: risk flags, opportunities, team pulse |
| AI Opportunities Pipeline | ✅ Live | Evidence-grounded, deduplicated, priority-scored |
| Inspection Scorecards | ✅ Live | 0–100 quality score, risk level, missed opportunities |
| PestPac & FieldRoutes Integration | ✅ Live | Manual sync, duplicate prevention, photo retry |
| Company Playbooks | ✅ Live | SOPs, required steps, chemical restrictions per tenant |
| Company Learning Engine | ✅ Live | Real-time compliance check against active playbooks |
| Executive Intelligence Dashboard | ✅ Live | Pipeline, quality, risk distribution, technician leaderboard |
| Role-based UI | ✅ Live | Owner / Manager / Sales / Technician tab sets |
| Stripe Billing | ✅ Live | Subscription management, usage tracking |

### Platform & infrastructure
| Area | Status |
|---|---|
| Multi-tenant isolation | ✅ All routes company-scoped + integration-tested |
| Local-first sync engine | ✅ Offline completion, background push |
| Anti-fabrication safeguards | ✅ Evidence grounding on all AI outputs |
| OpenAPI codegen (Orval) | ✅ Generated hooks + Zod from spec |
| Vitest test suite | ✅ Isolation, compliance, guidance, coverage, memory |

---

## Repo map (artifacts)

- `artifacts/readyloq-app` — Expo SDK 54 mobile app (primary deliverable)
- `artifacts/api-server` — Express 5 API + Gemini AI analysis pipeline
- `artifacts/readyloq-marketing` — ReadyLoq.com marketing site
- `artifacts/readyloq-growth-plan` — Internal growth plan slides
- `artifacts/readyloq-launch` — Product launch deck
- `readyloq-mobile/` — decoy skeleton, **ignore**

### Platform packages (`repos/platform/`)
12-package internal platform for extensible device + AI abstraction:
`platform-intelligence`, `camera-core`, `device-core`, `voice-intelligence`,
`measurement-core`, `smart-vision`, `asset-core`, `meta-wearables`, and supporting libs.

---

## Vision Platform (camera abstraction)

`artifacts/readyloq-app/lib/vision` is the source-agnostic capture layer:

- `types.ts` — `EvidenceItem` contract (never change shape lightly), `CaptureMode`, provider interfaces, `EvidenceIntake` sink.
- `provider-registry.ts` — runtime registry; sources are `CaptureProviderDefinition`s (`probe()` + `create()`).
- `native-camera-provider.ts`, `media-import-provider.ts` — Tier 1 sources (shipping).
- `future-source-providers.ts` — smart-glasses / USB / Wi-Fi / wearable stubs. **Adding a new source = replace one definition's `probe`/`create`; nothing downstream changes.**

---

## Run & Operate

```bash
pnpm --filter @workspace/api-server run dev   # API server (port 3000)
pnpm --filter @workspace/readyloq-app run dev  # Expo dev server (port 8082)
pnpm run typecheck                             # Full typecheck across all packages
pnpm run build                                 # Typecheck + build all
pnpm --filter @workspace/api-spec run codegen  # Regenerate API hooks/Zod from OpenAPI
pnpm --filter @workspace/db run push           # Push DB schema changes (dev only)
```

Required env: `DATABASE_URL` (Postgres), `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `AI_INTEGRATIONS_GEMINI_API_KEY`, `SESSION_SECRET`.

---

## Stack

- **Monorepo:** pnpm workspaces, Node.js 24, TypeScript 5.9
- **Mobile:** Expo SDK 54, Expo Router v4, Clerk auth, React Query, Reanimated 3
- **API:** Express 5, Drizzle ORM, PostgreSQL
- **AI:** Gemini 2.0 Flash (via Replit-managed proxy), Whisper.rn (on-device)
- **Validation:** Zod (`zod/v4`), drizzle-zod (`.extend()` broken — define JSONB schemas manually)
- **Tests:** Vitest + isolated `*_test` DB, Clerk `getAuth` mock

---

## Architecture decisions

- **Local-first capture:** evidence persists on-device immediately, then syncs; fully usable offline.
- **Real-capture AI (no simulation):** analysis runs on real evidence only; 0–1 confidence scores; no fabricated detections.
- **Source-agnostic pipeline:** all capture sources funnel through `EvidenceItem` into one persist → sync → analyze path.
- **Batched AI:** photos are analyzed in batches; FAIE runs incrementally as evidence accumulates.
- **Two-writer sync rule:** all local-record writes are serialized merge-updates; sync is single-flight.
- **drizzle-zod `.extend()` is broken** in this workspace (drizzle-zod@0.8.3 / zod@3.25.76 / zod/v4 mismatch). Pattern: `createInsertSchema(table).omit({...})` only; define JSONB validation schemas manually using `import { z } from "zod/v4"`.
- **New DB tables** — no drizzle-kit runner wired up; create via raw pg node client (see `company_playbooks` as reference).
- **`companyId` is always `integer`** — matches every other table in the schema.

---

## User preferences

- Do NOT propose tasks that push the product toward CRM functionality (lead tracking, contact management, pipeline stages, etc.). Keep feature scope focused on inspection, compliance, and pest intelligence workflows.

- Preserve the product vision above; keep ReadyLoq an AI assistant, not a form.
- Deprioritize dashboards/settings/analytics/admin behind the 8 field pillars.
- For hardware: build the abstraction, do **not** integrate real devices unless explicitly asked.
- **EAS builds** — never trigger automatically after a fix. Wait for an explicit command, or flag when enough changes have accumulated to justify one.
- **`Button` size prop** — only accepts `"md" | "lg"`, no `"sm"`.

---

## Gotchas

- `readyloq-mobile/` is a decoy — the real app is `artifacts/readyloq-app`.
- `expo-file-system` legacy imports must use `expo-file-system/legacy` for `documentDirectory`.
- Metro `watchFolders` excludes `.pnpm` to avoid ENOSPC on large dependency trees.
- `ble-plx` requires the `expo` override to avoid `tar@6.2.1` firewall block.
- EAS builds require `EAS_NO_VCS=1` and `EAS_SKIP_AUTO_FINGERPRINT=1` in the Replit sandbox.

---

## Developer setup

### GitHub token (GH_TOKEN)

Store a **classic Personal Access Token** in the `GH_TOKEN` secret with exactly these two scopes:

| Scope | Why |
|---|---|
| `repo` | Read/write access to private repositories |
| `workflow` | Update GitHub Actions workflow files |

Generate: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic). Check only `repo` and `workflow`.

---

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- See `.agents/memory/MEMORY.md` for cross-session architecture decisions and gotchas.
