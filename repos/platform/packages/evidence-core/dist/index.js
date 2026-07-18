/**
 * @platform/evidence-core
 *
 * Evidence lifecycle management — everything that happens to an EvidenceItem
 * AFTER it has been captured by camera-core.
 *
 * CANONICAL SOURCES:
 *   ReadyLoq (primary — most complete evidence lifecycle):
 *     repos/readyloq-mobile/artifacts/readyloq-app/lib/vision/types.ts
 *       — EvidenceItem (lifted to shared-types; referenced here via import)
 *     repos/readyloq-mobile/artifacts/readyloq-app/lib/vision/quality-gate.ts
 *       — QualityAssessment stored alongside each captured item
 *     repos/readyloq-mobile/artifacts/readyloq-app/lib/sync/engine.ts
 *       — evidence upload as step 3 of the 6-step sync pipeline
 *     repos/readyloq-mobile/artifacts/readyloq-app/lib/local/inspection-store.ts
 *       — local evidence store (AsyncStorage-backed, atomic RMW)
 *
 *   VYBE (secondary — evidence as stream media):
 *     repos/vybelive/artifacts/mobile/lib/uploadMedia.ts
 *       — upload flow for stream thumbnails, clips, cover images
 *     StreamRecording from live-session-core is a specialised EvidenceItem
 *       (video captured during a live session)
 *
 * WHY A SEPARATE PACKAGE FROM camera-core:
 *   camera-core is about ACQUISITION — getting frames from a device.
 *   evidence-core is about PERSISTENCE — storing, annotating, querying, and
 *   exporting those frames once they leave the capture pipeline.
 *   The two are decoupled: camera-core emits EvidenceItem; evidence-core
 *   takes it from there. Apps that import evidence but have no camera
 *   (e.g. a web dashboard reviewing field evidence) can depend on evidence-core
 *   without pulling in camera-core.
 *
 * DEPENDENCY GRAPH:
 *   evidence-core → shared-types   (EvidenceItem, QualityAssessment)
 *   evidence-core → storage-core   (upload to object storage)
 *   camera-core  does NOT depend on evidence-core (one-way flow)
 */
export {};
//# sourceMappingURL=index.js.map