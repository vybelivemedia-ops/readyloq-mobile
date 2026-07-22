/**
 * @platform/smart-vision/live-session — unified pipeline event system.
 *
 * The PipelineEventBus is the single event surface applications subscribe to.
 * It unifies events from all pipeline stages — Smart Vision, Privacy Engine,
 * Quality, Tracking, Zoom, and Auto Capture — into one typed bus.
 *
 * Applications never need to subscribe to the individual sub-engine buses.
 *
 * Event namespace: all kinds are prefixed "pipeline." to avoid collision with
 * "sv." (SmartVision) and "privacy." (PrivacyEngine) internal buses.
 *
 * GOVERNANCE: Payloads carry no domain strings.
 * See repos/platform/GOVERNANCE.md.
 */
export {};
