/**
 * BLE hardware driver layer — ReadyLoq
 *
 * Currently ships one driver: Meta Ray-Ban Smart Glasses (react-native-ble-plx).
 * Future drivers (USB scope, wearable cam) will be added alongside as siblings.
 */

export {
  smartGlassesBle,
  // UUIDs — exported for testing and display
  GLASSES_SERVICE_UUID,
  FRAME_CHAR_UUID,
  AUDIO_CHAR_UUID,
  CONTROL_CHAR_UUID,
  NORDIC_UART_SERVICE_UUID,
  NORDIC_UART_TX_UUID,
} from "./smart-glasses-ble";

export type {
  GlassesConnectionState,
  DiscoveredGlasses,
  SmartGlassesBleState,
  FrameCallback,
  AudioCallback,
  StateChangeCallback,
} from "./smart-glasses-ble";

export { checkBlePermissions, requestBlePermissions } from "./permissions";
export type { BlePermissionStatus } from "./permissions";

export { smartGlassesProvider, SmartGlassesProvider } from "./smart-glasses-provider";
