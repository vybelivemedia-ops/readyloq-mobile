/**
 * @platform/smart-vision/privacy — provider contracts.
 *
 * PrivacyProvider: the AI-model adapter interface.
 *
 * Applications register a provider when creating a PrivacyEngine.
 * The engine calls the provider for inference; the provider calls whatever
 * model, cloud service, or on-device framework it wraps.
 *
 * The engine never knows HOW inference is performed — only WHAT was returned.
 *
 * Provider examples (implemented in application layer, not here):
 *   OpenAIVisionProvider   — OpenAI GPT-4o vision API
 *   GeminiVisionProvider   — Google Gemini Vision API
 *   MediaPipeProvider      — MediaPipe object detection tasks
 *   AppleVisionProvider    — Apple Vision framework (iOS/macOS)
 *   CoreMLProvider         — CoreML on-device model
 *   TFLiteProvider         — TensorFlow Lite on-device model
 *   ONNXProvider           — ONNX Runtime on-device model
 *   YOLOProvider           — YOLO family models (various backends)
 *   EnterpriseProvider     — custom enterprise vision API
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
export {};
