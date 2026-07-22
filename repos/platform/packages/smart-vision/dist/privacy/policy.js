"use strict";
/**
 * @platform/smart-vision/privacy — policy contracts.
 *
 * A PrivacyPolicy is a data object — not a class with methods.
 * It describes WHAT to redact (per class) and HOW (redaction type + strength).
 * The engine reads the policy; the policy never drives the engine.
 *
 * Applications configure policies; the platform never hardcodes decisions.
 *
 * GOVERNANCE: No class-specific logic. No application-specific presets.
 * See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
