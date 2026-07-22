"use strict";
/**
 * @platform/smart-vision — super-resolution (upscaling) contracts.
 *
 * Defines the interface for on-device or server-assisted super-resolution.
 * The implementation (ML model, API call, fallback bicubic) is injected by
 * the application; this package owns only the contract.
 *
 * No domain logic — super-resolution is a pure signal-processing capability.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCALE_MULTIPLIER = void 0;
/**
 * Maps each ScalePreset to its numeric multiplier.
 * Exported as a plain value so callers can avoid hardcoding the numbers.
 */
exports.SCALE_MULTIPLIER = {
    "2x": 2,
    "4x": 4,
    "8x": 8,
};
