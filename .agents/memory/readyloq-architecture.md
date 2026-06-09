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
- Tailwind CSS + shadcn/ui, teal/cyan primary (--primary: 185 80% 35%)

## Conventions
- All hooks: import from `@workspace/api-client-react`, never relative
- Hook query options pattern: `useGetThing(id, { query: { enabled: !!id } })`
- API routes registered in `artifacts/api-server/src/routes/index.ts` under `/inspections`, `/analysis`, `/dataset`, `/reports`, `/training`, `/analytics`, `/branding`
- Training route uses `/training/quizzes` and `/training/scores` and `/training/leaderboard` sub-paths
- QueryClientProvider + TooltipProvider + Toaster all live in App.tsx (not main.tsx)

## Seed Data
- Seed script: `artifacts/api-server/src/seed.ts` — run with `npx tsx artifacts/api-server/src/seed.ts`
- 8 inspections, 3 analysis results, 18 dataset images, 2 reports, 4 quizzes, 11 training scores seeded

**Why:** Wouter's `<Router base>` must strip trailing slash from BASE_URL to avoid double-slash routing bugs.
