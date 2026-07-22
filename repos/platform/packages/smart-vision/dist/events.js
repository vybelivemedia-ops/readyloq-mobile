"use strict";
/**
 * @platform/smart-vision — typed event system.
 *
 * All significant state changes in the SmartVisionEngine are published as
 * typed events on the SmartVisionEventBus. Applications subscribe to the
 * events they care about and ignore the rest.
 *
 * Event namespace: all kinds are prefixed "sv." to avoid collision with
 * other platform event buses.
 *
 * GOVERNANCE: Event payloads carry no domain strings.
 *   classId values in detection payloads are still app-defined integers.
 *   See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
