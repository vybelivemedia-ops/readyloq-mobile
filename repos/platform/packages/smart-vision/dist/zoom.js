"use strict";
/**
 * @platform/smart-vision — smart zoom and subject locking contracts.
 *
 * Smart zoom computes optical/digital zoom adjustments from the visual context
 * (subject size, coverage, proximity to frame edge). Subject locking maintains
 * a stable tracking lock on a designated primary subject across zoom changes.
 *
 * No domain logic — callers decide what constitutes a "subject".
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
