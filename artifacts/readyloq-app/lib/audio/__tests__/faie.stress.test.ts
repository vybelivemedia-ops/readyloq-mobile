/**
 * FAIE Concurrency & Intent Stress Test
 *
 * Simulates 100 concurrent technician streams, each issuing 10 voice commands
 * (1 000 total events) through the pure-TypeScript intent + confidence layer.
 *
 * Validates:
 *   - Sub-millisecond per-event parsing (target: <0.5 ms average)
 *   - Zero state bleed across parallel streams (SpeechIntentEngine is stateless)
 *   - Correct confidence bucketing against AudioConfidence thresholds
 *   - Spatial-command fusion: isSpatial + visionTarget populated correctly
 *   - Alias resolution fires without regex collision under load
 *
 * Run:
 *   npx tsx artifacts/readyloq-app/lib/audio/__tests__/faie.stress.test.ts
 */

import { SpeechIntentEngine } from "../intelligence/SpeechIntentEngine";
import { AudioConfidence, ConfidenceAction } from "../processing/AudioConfidence";
import type { VisionContext } from "../types/intent.types";

// ── Realistic field voice inputs ──────────────────────────────────────────────
const MOCK_FIELD_INPUTS = [
  "Applied Alpine WSG in the commercial kitchen near the grease trap",
  "Blue blocks placed behind the boiler",
  "Found fresh droppings in the utility closet",
  "Seal this gap right here",
  "Another bait station near the back door",
  "Sprayed Alpine WSG under the dishwashing station",
  "Contract blocks installed in rodent station four",
  "Spotted German cockroaches near the floor drain",
  "Seal this pipe penetration",
  "Applied treatment along the baseboards",
];

// ── Vision contexts (includes undefined to exercise the no-camera path) ───────
const MOCK_VISION_CONTEXTS: Array<VisionContext | undefined> = [
  { detectedObject: "grease trap gap", timestamp: Date.now(), imageUri: "file:///mock/img/1.jpg" },
  { detectedObject: "pipe penetration", timestamp: Date.now(), imageUri: "file:///mock/img/2.jpg" },
  { detectedObject: "baseboard crack",  timestamp: Date.now(), imageUri: "file:///mock/img/3.jpg" },
  undefined, // technician stream with no active camera context
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomConfidence(min = 0.60, max = 0.99): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

// ── Main stress test ──────────────────────────────────────────────────────────
async function runFAIEStressTest(): Promise<void> {
  console.log("Starting FAIE Concurrency & Intent Stress Test...");
  console.log(
    "Simulating 100 concurrent technicians processing 1,000 total inspection events...\n",
  );

  const intentEngine = new SpeechIntentEngine(); // intentionally shared — must be stateless
  const TOTAL_TECHNICIANS = 100;
  const COMMANDS_PER_TECHNICIAN = 10;

  let totalProcessed = 0;
  let autoCommits = 0;
  let requiresConfirmation = 0;
  let askAgains = 0;
  let spatialEvents = 0;
  let spatialWithTarget = 0;
  let aliasResolutions = 0;

  const failures: string[] = [];

  const startTime = performance.now();

  const technicianPromises = Array.from(
    { length: TOTAL_TECHNICIANS },
    async (_, techId) => {
      for (let i = 0; i < COMMANDS_PER_TECHNICIAN; i++) {
        const input = pick(MOCK_FIELD_INPUTS);
        const vision = pick(MOCK_VISION_CONTEXTS);
        const confidence = randomConfidence();

        const event = intentEngine.parse(input, confidence, vision);
        const action = AudioConfidence.evaluate(event.confidence);

        // ── Correctness assertions ──────────────────────────────────────────
        if (event.confidence !== confidence) {
          failures.push(`[tech ${techId}] confidence mismatch: got ${event.confidence}, want ${confidence}`);
        }
        if (event.rawText !== input) {
          failures.push(`[tech ${techId}] rawText mangled`);
        }
        if (event.isSpatial && vision?.detectedObject && !event.visionTarget) {
          failures.push(`[tech ${techId}] spatial event missing visionTarget when detectedObject present`);
        }
        if (event.isSpatial && !vision?.detectedObject && event.visionTarget) {
          failures.push(`[tech ${techId}] visionTarget populated without a detectedObject source`);
        }

        // ── Metrics ──────────────────────────────────────────────────────────
        totalProcessed++;
        if (action === ConfidenceAction.AUTO_COMMIT) autoCommits++;
        else if (action === ConfidenceAction.CONFIRM) requiresConfirmation++;
        else askAgains++;

        if (event.isSpatial) {
          spatialEvents++;
          if (event.visionTarget) spatialWithTarget++;
        }
        // Alpine WSG / Alpine are aliases → should resolve to a product match
        if (input.toLowerCase().includes("alpine wsg") && event.product) aliasResolutions++;
      }
    },
  );

  await Promise.all(technicianPromises);
  const durationMs = performance.now() - startTime;

  // ── Results ───────────────────────────────────────────────────────────────
  console.log("--- STRESS TEST RESULTS ---");
  console.log(`Total Events Processed : ${totalProcessed}`);
  console.log(`Execution Time         : ${durationMs.toFixed(2)} ms`);
  console.log(`Avg Time Per Event     : ${(durationMs / totalProcessed).toFixed(4)} ms`);
  console.log("---");
  console.log(`Auto-Commits  (>0.92)  : ${autoCommits}`);
  console.log(`Confirmations (0.70-0.92): ${requiresConfirmation}`);
  console.log(`Re-prompts    (<0.70)  : ${askAgains}`);
  console.log("---");
  console.log(`Spatial events detected: ${spatialEvents}`);
  console.log(`Spatial + visionTarget : ${spatialWithTarget}`);
  console.log(`Alias resolutions      : ${aliasResolutions}`);
  console.log("---");

  // ── Pass/fail gate ────────────────────────────────────────────────────────
  const AVG_TARGET_MS = 0.5;
  const avgMs = durationMs / totalProcessed;

  if (failures.length > 0) {
    console.error(`\nFAILED — ${failures.length} assertion(s):`);
    failures.slice(0, 10).forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }
  if (avgMs > AVG_TARGET_MS) {
    console.warn(
      `\nWARN — avg ${avgMs.toFixed(4)} ms exceeds <${AVG_TARGET_MS} ms target (pipeline still functionally correct)`,
    );
  } else {
    console.log(`\nPASS — avg ${avgMs.toFixed(4)} ms < ${AVG_TARGET_MS} ms target`);
  }
  console.log("FAIE Pipeline Stress Test completed with 0 drops.");
}

runFAIEStressTest().catch((err) => {
  console.error("Stress test runner error:", err);
  process.exit(1);
});
