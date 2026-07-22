/**
 * @platform/device-core
 *
 * Universal hardware abstraction layer.
 *
 * Every hardware provider — camera, microphone, sensor, wearable, IoT device —
 * implements DeviceProvider. The inspection engine and stream engine never know
 * the manufacturer. They ask for a DeviceProvider with certain DeviceCapabilities
 * and the DeviceRegistry routes to the best available one.
 *
 * NEW DEVICE IN 3 YEARS?
 *   Write one new DeviceProvider implementation. Register it.
 *   The rest of the platform works unchanged.
 *
 * READYLOQ DEVICES (all implement DeviceProvider):
 *   Native camera     — already registered via camera-core
 *   Moisture meters   — sensor category, wired/ble transport
 *   Thermal imagers   — sensor + camera category, usb/wifi transport
 *   Borescopes        — camera category, usb/wifi transport
 *   Laser distance    — sensor category, ble transport
 *   Environmental     — sensor category, ble/wifi transport
 *   Smart bait traps  — sensor + actuator category, ble/cellular transport
 *   BLE IoT devices   — sensor category, ble transport
 *
 * VYBE DEVICES (all implement DeviceProvider):
 *   Native camera     — already registered via camera-core
 *   Meta Ray-Ban      — wearable + camera category, ble/wifi transport
 *   GoPro             — camera category, usb/wifi transport
 *   DJI               — camera category, wifi/cellular transport
 *   Insta360          — camera category, usb/wifi transport
 *   FLIR thermal      — camera + sensor category, usb/wifi transport
 *   Future LiDAR      — sensor category, usb/wifi transport
 *
 * DEPENDENCY GRAPH:
 *   device-core → core
 *   device-core → shared-types
 *   device-core → provider-registry  (DeviceRegistry extends ManagedRegistry)
 *
 * hardware packages depend on device-core:
 *   camera-core, voice-intelligence, measurement-core, meta-wearables
 *   (refactor pass — they adopt DeviceProvider as their foundation)
 *
 * GOVERNANCE:
 *   No domain logic lives here. DeviceCapabilities.tokens are generic strings.
 *   The application layer assigns meaning (e.g. "capture.photo", "sensor.temperature").
 *   DeviceProfile.settings is Record<string, unknown> — the app defines the schema.
 */
export {};
