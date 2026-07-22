/**
 * @platform/smart-vision — image enhancement provider contracts.
 *
 * Defines interfaces for on-device or server-assisted image enhancement.
 * Implementations are injected by the application; this package owns only
 * the contracts. Enhancement passes operate on raw frames and are
 * composable via EnhancementPipeline.
 *
 * Supported passes: denoising · sharpening · HDR tone-mapping · contrast.
 *
 * No domain logic — enhancement is a pure signal-processing concern.
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
export {};
