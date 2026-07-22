/**
 * @platform/voice-intelligence
 *
 * Voice capture, transcription, and command routing.
 *
 * STATUS: New package — no existing code to extract from either repo.
 *
 * PLANNED IN BOTH APPS:
 *   ReadyLoq (from roadmap comments in provider-registry.ts):
 *     "Phase Next: voice memo capture during inspections"
 *     — technician dictates findings hands-free while photographing.
 *   VYBE LIVE (from OS types and mission-control UI):
 *     — voice commands for stream control ("go live", "end stream")
 *     — AI transcription of stream audio for auto-captioning
 *
 * DEVICE-CORE ADOPTION (Phase 15 — @platform/device-core):
 *   MicrophoneDeviceProvider extends DeviceProvider, giving microphone hardware
 *   the full device lifecycle: connect/disconnect, status, health checks,
 *   permissions, and events. VoiceRecorder extends MicrophoneDeviceProvider so
 *   the microphone hardware interface participates in the device registry.
 *
 * DEPENDENCY GRAPH:
 *   voice-intelligence → shared-types
 *   voice-intelligence → device-core → provider-registry → core
 *   voice-intelligence → ai-core  (transcription uses AIProvider)
 *   camera-core does NOT depend on voice-intelligence — they are parallel
 *   capture channels that both produce EvidenceItem-like artefacts.
 *
 * IMPLEMENTATION NOTES:
 *   - Mobile: expo-speech / expo-av for recording, Whisper API for STT.
 *   - Web: MediaRecorder API + WebAudio for recording.
 *   - The VoiceRecorder produces a VoiceCapture (analogous to EvidenceItem).
 *   - TranscriptionService wraps an AIProvider to call the Whisper-compatible
 *     endpoint; provider selection goes through AIProviderFactory.
 *   - VoiceCommandRouter maps recognised phrases to typed Commands (app-defined
 *     in the consuming app, not in this package).
 */
export {};
