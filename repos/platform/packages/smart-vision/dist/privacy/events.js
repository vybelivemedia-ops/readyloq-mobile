"use strict";
/**
 * @platform/smart-vision/privacy — typed event system.
 *
 * All significant state changes in the Privacy Engine are published as typed
 * events on the PrivacyEventBus. Applications subscribe to events they care
 * about and ignore the rest.
 *
 * Event namespace: all kind strings are prefixed "privacy." to avoid collision
 * with SmartVisionEventBus ("sv.") events.
 *
 * GOVERNANCE: Payloads carry no domain strings.
 * See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
