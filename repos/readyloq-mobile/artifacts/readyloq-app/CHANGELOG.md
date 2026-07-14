# Changelog

## ReadyLoq Beta 0.9.0 (build 10) — hotfix

Android versionCode 10 · iOS buildNumber 2

### Fixes

- AI Inspection is now accessible on phones: a new "AI Insights" button in the camera view opens the live AI Inspection panel (detections, live report) as a full-screen overlay. Previously the AI Inspection Workspace only rendered on screens ≥ 840dp wide (tablets / unfolded foldables in landscape), leaving no entry point on phones
- The New Inspection screen now notes that AI Inspection runs live during capture

## ReadyLoq Beta 0.9.0 (build 9) — hotfix

Android versionCode 9 · iOS buildNumber 2

### Fixes

- App now signs in against the production authentication system (same accounts as readyloq.com) instead of the development one — fixes "workspace won't load" (401) after signing in

## ReadyLoq Beta 0.9.0 (build 8) — hotfix

Android versionCode 8 · iOS buildNumber 2

### Fixes

- Google sign-in no longer hands off to the wrong app (e.g. email compose) after authentication — the OAuth redirect now uses an explicit `readyloq-app://sso-callback` deep link
- Added an in-app landing screen for the sign-in callback
- Clear error messages when Google sign-in can't be completed

## ReadyLoq Beta 0.9.0 — "Opportunity Intelligence" (Closed Beta)

Android versionCode 7 · iOS buildNumber 2

### Major Features

- Fold 7 and large-screen optimization
- Responsive tablet and foldable layouts
- AI Inspection Workspace
- Live Report Builder
- AI Inspection Panel
- Opportunity Intelligence
- Inspection Scorecards
- Customer Property Summaries
- Sales Proposal Builder
- Management Intelligence Dashboard
- Background AI processing
- Role-based intelligence views
- Evidence-grounded AI recommendations
- Anti-fabrication safeguards
- Secure customer share links
- Opportunity notes and audit history

### Performance

- Improved stability
- Background processing improvements
- SDK 54 alignment
- Updated package versions
- Improved build reliability

### Known Upcoming Features

- Company Learning Engine
- Company Playbooks
- Property Memory
- Executive Intelligence Dashboard
- PestPac Integration
- FieldRoutes Integration
