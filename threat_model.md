# Threat Model

## Project Overview

ReadyLoq is an AI-assisted pest inspection platform with a React/Vite frontend (`artifacts/readyloq`), an Express API (`artifacts/api-server`), and a PostgreSQL database accessed through Drizzle (`lib/db`). The deployed application is public on Replit autoscale. Technicians create inspections, attach media, review AI analysis, generate reports, and use training content; managers also access analytics, callback intelligence, property-risk intelligence, and branding settings.

This threat model assumes production traffic is protected in transit by the platform. The main production security questions are therefore authentication, authorization, tenant/data isolation, API input handling, and exposure of sensitive operational data. The `artifacts/mockup-sandbox` app is treated as dev-only and out of scope unless production reachability is demonstrated.

## Assets

- **Inspection and report data** — site addresses, client names, technician names/IDs, notes, findings, recommendations, media URLs, and report content. Exposure would leak customer operational data and field activity.
- **Management intelligence** — callback chains, recurrence patterns, risk indicators, property-risk summaries, and technician performance metrics. Exposure would leak business-sensitive analytics and internal performance information.
- **Branding and tenant presentation settings** — company name, colors, support contacts, and logo references. Unauthorized modification could deface the product or misdirect customers.
- **Training and performance records** — quiz results, leaderboard data, and technician scoring. Exposure or tampering could affect personnel privacy and integrity of training metrics.
- **Application secrets and database access** — `DATABASE_URL` and any future API credentials held server-side. Compromise would enable full backend data access.

## Trust Boundaries

- **Browser to API** — all frontend requests cross from an untrusted client into the Express API. Every sensitive read or write must be authenticated and authorized server-side.
- **API to PostgreSQL** — the API has direct access to all application data. Any route-level access control failure exposes the full dataset behind that endpoint.
- **Public user to authenticated/privileged user** — inspections, reports, analytics, intelligence, training history, and branding controls are not safe to expose to anonymous internet users.
- **Technician to manager** — management-only intelligence and configuration surfaces require stronger authorization than standard technician workflows.
- **Production to dev-only code** — `artifacts/readyloq` and `artifacts/api-server` are production surfaces; `artifacts/mockup-sandbox` is dev-only unless explicitly wired into production.

## Scan Anchors

- Production API entry point: `artifacts/api-server/src/index.ts` and `artifacts/api-server/src/app.ts`
- Production route surface: `artifacts/api-server/src/routes/`
- Production frontend entry point: `artifacts/readyloq/src/App.tsx`
- Highest-risk areas: inspection/report/intelligence/branding routes; role handling in `artifacts/readyloq/src/hooks/use-role.ts`
- Public/auth/admin boundaries: deployment is public; current code should be treated as needing explicit auth on all sensitive API routes and manager-only checks on analytics/intelligence/branding
- Dev-only area to usually ignore: `artifacts/mockup-sandbox/`

## Threat Categories

### Spoofing

The application must not trust client-selected identity or role. Any user, browser, or script can reach the public deployment, so role or user identity derived from local storage, client parameters, or frontend routing is insufficient. Sensitive endpoints MUST require a real authenticated identity, and any future webhook or service-to-service integrations MUST verify origin/authenticity.

### Tampering

Clients can send arbitrary request bodies to all API endpoints. The server must enforce which records a caller may create, update, or delete, and must validate mutable fields before persisting them. Business-sensitive settings such as branding or analysis feedback MUST NOT be modifiable by anonymous or under-privileged callers.

### Information Disclosure

Inspection records, reports, analytics, callback data, technician metrics, and support contact data are sensitive. The API must scope reads to the authenticated tenant and role, and manager-only intelligence must not be exposed to technicians or anonymous users. Error handling and logs must avoid leaking secrets or unnecessary internal details.

### Denial of Service

Public endpoints should assume hostile callers can automate large volumes of requests. Expensive list or aggregation endpoints, repeated write actions, and media-related operations need reasonable abuse resistance, pagination/limits where relevant, and bounded processing so anonymous traffic cannot exhaust resources.

### Elevation of Privilege

Manager capabilities such as intelligence views, analytics, and branding changes require server-side authorization distinct from technician workflows. The system must enforce privilege boundaries in the API, not only in frontend route visibility or local UI state. Any route that reads or mutates another user’s or tenant’s data must reject unauthorized access.
