/**
 * @platform/smart-vision/privacy — concrete PrivacyEngine, PrivacySession, PrivacyFactory.
 *
 * Wires together detector → tracker → policy → mask builder → renderer → events → history.
 *
 * ORIGINAL MEDIA PRESERVATION:
 *   feedFrame() / processImage() never mutate the input VideoFrame.
 *   Masks are passed to the renderer; the renderer produces a separate copy.
 *   Applications decide which layer to display or store.
 *
 * ZERO DOMAIN LOGIC:
 *   The engine reads policy data; it never hardcodes which classes to redact.
 */
import type { PrivacyFactory } from "../engine";
/**
 * Create the Privacy Engine factory.
 *
 * Usage:
 *   const factory = createPrivacyFactory();
 *   const engine  = factory.createEngine({ provider: myProvider });
 *   const session = await engine.startSession(myPolicy);
 *   const result  = await session.feedFrame(frame);
 */
export declare function createPrivacyFactory(): PrivacyFactory;
//# sourceMappingURL=privacy-engine-impl.d.ts.map