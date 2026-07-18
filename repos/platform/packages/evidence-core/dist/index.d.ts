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
import type { EvidenceItem, QualityAssessment } from "@platform/shared-types";
/**
 * Persisted quality assessment for a stored evidence item.
 * Stored alongside the item so reviewers can see why a retake was suggested,
 * and so training pipelines can filter by quality band.
 */
export interface EvidenceQualityRecord {
    evidenceId: string;
    assessment: QualityAssessment;
    /** When the quality assessment was computed. */
    assessedAt: string;
    /** Whether the user was shown a retake prompt and dismissed it. */
    retakeDismissed?: boolean;
}
export type AnnotationKind = "note" | "region" | "tag" | "measurement";
/**
 * A user- or AI-authored annotation attached to a piece of evidence.
 *
 * VYBE: stream clips can be tagged with category labels.
 * ReadyLoq: technician notes and AI region detections on inspection photos.
 */
export interface EvidenceAnnotation {
    id: string;
    evidenceId: string;
    kind: AnnotationKind;
    /** Plain-text note or tag value. */
    text?: string;
    /**
     * Normalised bounding region (0–1 coordinates), if applicable.
     * Used for region annotations and AI detection overlays.
     */
    region?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Who or what created this annotation. */
    authorKind: "user" | "ai";
    authorId: string;
    createdAt: string;
    updatedAt?: string;
}
/**
 * A named grouping of EvidenceItems belonging to a single logical unit.
 *
 * ReadyLoq: one collection per inspection session (all photos from one visit).
 * VYBE: one collection per live stream session (thumbnail + clips + recording).
 *
 * The `entityType` + `entityId` pair links the collection to a domain record
 * in the consuming app (e.g. entityType="inspection", entityId="insp_abc").
 */
export interface EvidenceCollection {
    id: string;
    /** Domain entity this collection belongs to (app-defined). */
    entityType: string;
    entityId: string;
    label?: string;
    evidenceIds: string[];
    /** Primary/cover item shown in list views. */
    coverEvidenceId?: string;
    createdAt: string;
    updatedAt: string;
}
export interface EvidenceQuery {
    entityType?: string;
    entityId?: string;
    capturedAfter?: string;
    capturedBefore?: string;
    minQualityScore?: number;
    mimeTypes?: string[];
    limit?: number;
    offset?: number;
}
/**
 * Persistent store for EvidenceItems, quality records, and annotations.
 *
 * EXTRACTION NOTE: ReadyLoq currently stores evidence inside the Inspection
 * object in AsyncStorage. evidence-core generalises this to a dedicated store
 * with query capabilities. ReadyLoq migrates by wrapping its existing
 * AsyncStorage with an EvidenceStoreAdapter.
 */
export interface EvidenceStore {
    /** Persist a new EvidenceItem. */
    save(item: EvidenceItem, quality?: QualityAssessment): Promise<void>;
    /** Retrieve one item by ID. */
    get(evidenceId: string): Promise<EvidenceItem | null>;
    /** Query items matching the filter. */
    query(filter: EvidenceQuery): Promise<EvidenceItem[]>;
    /** Delete one item and its quality record + annotations. */
    delete(evidenceId: string): Promise<void>;
    /** Retrieve the quality record for an item. */
    getQuality(evidenceId: string): Promise<EvidenceQualityRecord | null>;
    /** Add or replace an annotation. */
    saveAnnotation(annotation: EvidenceAnnotation): Promise<void>;
    /** Retrieve all annotations for an item. */
    listAnnotations(evidenceId: string): Promise<EvidenceAnnotation[]>;
    /** Delete one annotation. */
    deleteAnnotation(annotationId: string): Promise<void>;
}
export type UploadPhase = "idle" | "compressing" | "uploading" | "verifying" | "complete" | "error";
export interface UploadProgress {
    evidenceId: string;
    phase: UploadPhase;
    /** 0–1 upload progress within the uploading phase. */
    bytesRatio?: number;
    error?: string;
}
/**
 * Manages the full upload pipeline for evidence: optional compression →
 * object storage PUT → URL persistence in the evidence store.
 *
 * Consumers listen to progress via the callback; the pipeline is resumable
 * (if the upload step is complete, verification is retried on next call).
 */
export interface EvidenceUploadPipeline {
    /**
     * Queue one or more items for upload. Returns immediately; upload runs
     * in the background. Subscribe to onProgress for status.
     */
    enqueue(items: EvidenceItem[]): void;
    /** Force all queued items to upload now (e.g. before app backgrounds). */
    flushNow(): Promise<void>;
    /** Subscribe to per-item progress updates. */
    onProgress(listener: (progress: UploadProgress) => void): () => void;
    /** Cancel in-flight uploads and clear the queue. */
    cancel(): void;
}
export interface EvidenceCollectionManager {
    create(opts: {
        entityType: string;
        entityId: string;
        label?: string;
    }): Promise<EvidenceCollection>;
    addEvidence(collectionId: string, evidenceId: string): Promise<void>;
    removeEvidence(collectionId: string, evidenceId: string): Promise<void>;
    setCover(collectionId: string, evidenceId: string): Promise<void>;
    get(collectionId: string): Promise<EvidenceCollection | null>;
    listForEntity(entityType: string, entityId: string): Promise<EvidenceCollection[]>;
    delete(collectionId: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map