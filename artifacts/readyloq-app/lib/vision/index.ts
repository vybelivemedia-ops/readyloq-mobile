export * from "./types";
export { assessEvidence } from "./quality-gate";
export { loadGrayscaleImage, type GrayscaleImage } from "./pixels";
export {
  computeDHash,
  findNearDuplicate,
  hammingDistance,
  DUP_HAMMING_THRESHOLD,
} from "./dedupe";
export { createNativeCameraProvider } from "./native-camera-provider";
export { createMediaImportProvider } from "./media-import-provider";
export {
  describeCaptureSource,
  isLowQuality,
  LOW_QUALITY_THRESHOLD,
  type CaptureSourceInfo,
} from "./source-info";
