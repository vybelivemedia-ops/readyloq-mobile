# Post Launch Website — VYBE 2.0 "AI Headquarters"

**Status: PRESERVED — DO NOT DEPLOY until Founder approval AND VYBE Live launch milestones are met.**

This directory is the complete, production-ready preservation of the VYBE 2.0
"AI Creator Headquarters" website (originally shipped in commit `070a0f2`,
June 25 2026). It was intentionally rolled back from production as a strategic
decision: the live site must support today's VYBE Live launch, while this
version represents the post-launch, long-term vision.

## What's preserved here

The V2 redesign changed exactly 4 files relative to the launch site. All 4 are
preserved here, with beta/waitlist messaging already replaced by
production-ready CTAs (Phase 5 of the rollback objective):

| File | Restores to | Notes |
|---|---|---|
| `Home.tsx` | `src/pages/Home.tsx` | Cinematic AI HQ landing (V tower, 7 departments, AI core, pricing) |
| `Roadmap.tsx` | `src/pages/Roadmap.tsx` | HQ blueprint, creator counter, milestone dashboard |
| `Navbar.tsx` | `src/components/Navbar.tsx` | Glass nav with "Get the App" CTA |
| `index.css` | `src/index.css` | V2 fonts (Barlow Condensed), particle/drift animations |

All other pages/components (About, Contact, Privacy, Terms, Footer, admin
pages, UI kit) are shared with the live site and unchanged.

## CTA changes already applied (Phase 5)

Beta/waitlist-specific messaging was replaced; the V2 "Headquarters" brand
voice was intentionally preserved (Phase 1 requires preserving copy):

- All `open-waitlist` triggers → `openGetApp()` navigating to `GET_APP_URL`
  (every CTA button now points at the app, none open a waitlist)
- "Become a Founding Creator" buttons → "Download VYBE Live"
- Nav "Enter HQ" / "Enter Headquarters" buttons → "Get the App"
- "Internal Beta Active" badge → "Live in Production"
- "Internal Beta Testing 45%" milestone bar → "Public Launch 100%"
- "Beta Signups" stat → "Creators Joined"
- "Free to Join · No Credit Card · Limited Founding Creator Spots" →
  "Free to Download · Available on iOS & Android" / "· Available Now"
- `WaitlistModal` import removed from Home

Intentionally KEPT (thematic, production-valid, no beta reference):
hero/final CTA labels "Enter Headquarters", pricing CTAs "Enter HQ" /
"Activate Your AI Team", Roadmap CTAs "Enter the Future" / "Help Build
Headquarters", and the Founding Creators counter (post-launch it reads from
the same `/api/roadmap` count — relabel at deploy time if the program ends).

## How to deploy V2 later (minimal effort)

1. Set `GET_APP_URL` in `Home.tsx`, `Roadmap.tsx`, `Navbar.tsx` to the final
   App Store / Google Play link (currently a `/download` placeholder — a
   `/download` route does NOT exist yet).
2. Copy the files back:
   ```bash
   cp v2-post-launch/Home.tsx    src/pages/Home.tsx
   cp v2-post-launch/Roadmap.tsx src/pages/Roadmap.tsx
   cp v2-post-launch/Navbar.tsx  src/components/Navbar.tsx
   cp v2-post-launch/index.css   src/index.css
   ```
3. Optionally remove the now-unused `WaitlistModal`, `ProgressBanner`,
   `MetaGlassesSection` beta components (or keep them).
4. Run `pnpm --filter @workspace/website run typecheck` and verify.

This directory is outside `src/`, so it is excluded from typecheck and the
production bundle — it ships nothing to users while preserved.

The original, unmodified V2 (with beta CTAs) also remains fully recoverable
from git history at commit `070a0f2`.
