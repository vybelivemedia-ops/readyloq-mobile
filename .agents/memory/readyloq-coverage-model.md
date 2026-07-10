---
name: ReadyLoq live-inspection coverage model
description: Zone-based completeness scoring — how live-analyze and finalize must agree, and the async-dedupe carry-over invariant
---

# Coverage / completeness scoring

Completeness % is a zone-coverage model: a fixed set of property zones, an
R/r/– requirement matrix across normalized property types + pest overlays, and
ONLY Required zones drive the percentage. Suggested zones are informational and
must stay OUT of treatment recommendations — recommendations are grounded only
in real detections (finding.treatment).

## Two compute sites must agree
Coverage is computed in BOTH the live analyze path and the finalize path from
the SAME inputs: per-photo zones (union) + zones derived from findings, scored
against propertyType (derived from inspection notes) + inspection pestTypes.
The pure scorer is deterministic, so identical inputs → identical value; the
only intended divergence is when the technician edits pest types / property type
after the last live analyze (finalize recomputes from the stored per-photo
zones).
**Why:** the number the tech sees live must equal the finalized report's value.
**How to apply:** if you change the zone taxonomy, requirement matrix,
property-type normalization, or the finding→zone derivation, change it in the
shared lib so BOTH sites move together.

## Async-dedupe carry-over invariant
The mobile pixel-dedupe pass is asynchronous: a photo analyzed in run N can be
flagged `duplicateOf` afterwards and then omitted from run N+1's submitted
images[]. The analyze route MUST carry over previously-analyzed photos'
findings AND per-photo zones for every photo that is still a saved,
company-scoped media row — not just the ones resubmitted this run. Otherwise a
late-flagged duplicate silently drops its finding + zone and coverage regresses.
**Why:** found in review; the carry-over loop originally iterated only over
submitted images.
**How to apply:** gate carry-over on the media row still existing (saved +
company scope) so genuinely deleted photos are still dropped.
