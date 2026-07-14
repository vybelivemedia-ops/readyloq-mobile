---
name: Marketing autonomy learning system
description: Dario Sol learning-based publishing — enum contract rule, key thresholds, and design decisions
---

# Marketing autonomy (Mission Control)

## OpenAPI enums must mirror DB pgEnum values verbatim
**Why:** Zod validation passed but DB insert 500'd — OpenAPI used `legal_claim`/`investor_content`/`crisis_response`/`policy_statement` while the pgEnum defined `legal_announcement`/`investor_communication`/`crisis_communication`/`policy_change`. Typecheck cannot catch this because the service inserts the string straight through.
**How to apply:** when a request body field feeds a pgEnum column, copy the enum values from the schema file into the OpenAPI spec (and any frontend option list) verbatim; test every enum value with curl, not just one.

## Design decisions (durable)
- Trusted mode qualification: ≥50 founder-approved posts AND ≥95% prediction accuracy AND ≥50 scored predictions. PREDICT_APPROVE_AT=70 (confidence ≥70 predicts "approve").
- Auto-publish gate: low-risk types only AND trusted mode AND confidence ≥85. High-risk types NEVER auto-publish in any mode.
- Suspension (Quinn → learning mode): accuracy<90, engagement drop (recent-3 avg < 50% of prior-6 avg), ≥3 overrides in last 10 decisions, brand consistency<60 (clean approvals in last 20 decided), or founder disable. Rejecting an auto-published post counts as an override.
- Autonomy state is a DB singleton row; counter increments use `sql\`col + 1\`` (atomic), not read-modify-write.
- Learning profile is derived on read from approved posts (tones/CTAs/hashtags/length/platform counts) — no stored profile table to drift.
