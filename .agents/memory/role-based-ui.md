---
name: Role-Based UI
description: Tab bar differentiation, new screens, and permission structure for all four user roles
---

# Role-Based UI Architecture

## Tab structure per role

| Role        | Tabs                                              |
|-------------|---------------------------------------------------|
| Technician  | Dashboard · Inspections · Connections             |
| Sales       | Dashboard · Scan · Reports · Leads                |
| Manager     | Dashboard · Review · Reports · Team               |
| Owner       | Dashboard · Reports                               |

All `<Tabs.Screen>` entries are always declared in `_layout.tsx`; hidden tabs use `href: null`.
Role comes from `useCurrentUser()` → `user.role`; defaults to "technician" while loading.

## New screen files
- `app/(app)/(tabs)/scan.tsx` — Sales: property vulnerability scan, links to /new-inspection, lists recent reports in sales language
- `app/(app)/(tabs)/review.tsx` — Manager: rapid-review workflow (Approve/Flag/Skip cards, <20 min target), uses `GET/POST /api/review-queue`
- `app/(app)/(tabs)/team.tsx` — Manager: per-tech scorecards with 7d/30d/90d period selector, badge display
- `app/(app)/(tabs)/leads.tsx` — Sales: pipeline with filter chips, uses `GET /api/opportunities`

## API additions
- `GET /api/review-queue` — yesterday's completed inspections sorted critical→high→medium→low; requires manager role
- `POST /api/review-queue/:id` — advisory approve/flag/skip; no DB write (client tracks session state)
- Route file: `artifacts/api-server/src/routes/review-queue.ts`
- Registered in `routes/index.ts` with `requireRole("manager")`

## Dashboard (index.tsx) — role-specific hero CTA
- Technician: "Start AI Inspection" → /new-inspection
- Sales: "Start Property Scan" → /new-inspection  
- Manager: "Review Yesterday's Work" → /(tabs)/review (highlights pending count)
- Owner: "Daily Executive Briefing" → /(tabs)/reports + KPI strip + comms quick-dial

## API call pattern in new screens
Use `customFetch<T>()` from `@/lib/api-client/custom-fetch` — auth token is injected automatically via the registered getter. Do NOT import `apiFetch` from `@/lib/api` (doesn't exist as a named export).

## Type notes
- `BadgeTone` valid values: "default" | "primary" | "success" | "warning" | "danger" | "info"  — NOT "destructive"
- `OwnerBriefing.kpis` fields: `completions7d`, `completions30d`, `openOpportunities`, `pipelineValue`, `avgQualityScore30d`, `approvedSummaries30d`

**Why:** Role differentiation was previously display-only (RoleBriefingView); now structural (different tab bar per role). Future role additions must update `_layout.tsx` tab visibility logic and the dashboard CTA switch.
