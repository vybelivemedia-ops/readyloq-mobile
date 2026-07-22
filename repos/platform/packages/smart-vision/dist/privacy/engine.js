"use strict";
/**
 * @platform/smart-vision/privacy — engine + session contracts.
 *
 * PrivacyEngine: lifecycle manager (create, start sessions, destroy).
 * PrivacySession: active session that processes frames.
 * PrivacyFactory: entry point for application code.
 *
 * ARCHITECTURE:
 *   PrivacyFactory.createEngine(deps)   → PrivacyEngine (idle)
 *   engine.startSession(policy, config) → PrivacySession (running)
 *   session.feedFrame(frame)            → PrivacyFrameResult
 *   session.stop()                      → void
 *   engine.destroy()                    → void
 *
 * GOVERNANCE: Zero domain logic. All behaviour injected via deps + policy.
 * See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
