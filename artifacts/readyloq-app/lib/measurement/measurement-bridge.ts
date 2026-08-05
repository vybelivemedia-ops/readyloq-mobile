/**
 * Measurement Bridge
 *
 * Module-level singleton that caches the most recent measurement reading
 * stamped by the technician via MeasurementDevicePanel → onStamp.
 *
 * Bridges three surfaces:
 *   1. MeasurementDevicePanel "Stamp" button  →  setLastMeasurementReading()
 *   2. Photo capture in new-inspection.tsx    →  consumeLastMeasurementReading()
 *        attaches reading to captureMetadata so synced photos carry it
 *   3. Exclusion Work tab                     →  useMeasurementBridge() hook
 *        drives real-time per-linear-foot pricing from the active laser reading
 *
 * Freshness: readings older than STALE_AFTER_MS are treated as absent.
 * consumeLastMeasurementReading() clears the cache after a single use so the
 * same laser shot is not attached to two different photos.
 */

import { useState, useEffect } from "react";
import type { MeasurementReading } from "@platform/measurement-core";

const STALE_AFTER_MS = 90_000; // 90 seconds

interface BridgeEntry {
  reading: MeasurementReading;
  stampedAt: number; // Date.now()
}

let _last: BridgeEntry | null = null;
const _listeners = new Set<() => void>();

function _notify(): void {
  _listeners.forEach((l) => l());
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Store a fresh reading from the Stamp button and notify subscribers. */
export function setLastMeasurementReading(reading: MeasurementReading): void {
  _last = { reading, stampedAt: Date.now() };
  _notify();
}

/** Clear the cached reading (e.g. when an inspection is discarded). */
export function clearMeasurementReading(): void {
  _last = null;
  _notify();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns the last stamped reading if it is still within the freshness window,
 * otherwise null.
 */
export function getLastMeasurementReading(
  maxAgeMs = STALE_AFTER_MS,
): MeasurementReading | null {
  if (!_last) return null;
  if (Date.now() - _last.stampedAt > maxAgeMs) return null;
  return _last.reading;
}

/** True when a fresh reading is currently cached. */
export function hasFreshMeasurementReading(maxAgeMs = STALE_AFTER_MS): boolean {
  return getLastMeasurementReading(maxAgeMs) !== null;
}

/**
 * Returns the last reading AND clears it from the cache.
 * Use when attaching a reading to a photo so it is not reused for the next one.
 */
export function consumeLastMeasurementReading(
  maxAgeMs = STALE_AFTER_MS,
): MeasurementReading | null {
  const reading = getLastMeasurementReading(maxAgeMs);
  if (reading) {
    _last = null;
    _notify();
  }
  return reading;
}

/** How many seconds ago the last reading was stamped, or null if none. */
export function measurementAge(): number | null {
  if (!_last) return null;
  return Math.round((Date.now() - _last.stampedAt) / 1000);
}

// ─── Subscription / React hook ────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * React hook that reactively returns the current fresh reading.
 * Re-renders whenever a new reading is stamped or the cache is cleared.
 */
export function useMeasurementBridge(
  maxAgeMs = STALE_AFTER_MS,
): MeasurementReading | null {
  const [reading, setReading] = useState<MeasurementReading | null>(() =>
    getLastMeasurementReading(maxAgeMs),
  );

  useEffect(() => {
    // Sync on mount in case a reading arrived before this component mounted.
    setReading(getLastMeasurementReading(maxAgeMs));
    return subscribe(() => setReading(getLastMeasurementReading(maxAgeMs)));
  }, [maxAgeMs]);

  return reading;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a MeasurementReading (distance kind, any unit) to linear feet.
 * Returns null for non-distance readings.
 */
export function readingToLinearFt(reading: MeasurementReading): number | null {
  if (reading.kind !== "distance") return null;
  switch (reading.unit) {
    case "m":   return reading.value * 3.28084;
    case "ft":  return reading.value;
    case "in":  return reading.value / 12;
    case "cm":  return reading.value * 0.0328084;
    case "mm":  return reading.value * 0.00328084;
    default:    return null;
  }
}

/**
 * Format a reading as a concise label for display.
 * e.g. "3.42 m" or "11.2 ft"
 */
export function formatReadingCompact(reading: MeasurementReading): string {
  const { kind, value, unit } = reading;
  if (kind === "distance") {
    if (unit === "m")  return `${value.toFixed(2)} m`;
    if (unit === "ft") return `${value.toFixed(1)} ft`;
    if (unit === "in") return `${value.toFixed(1)} in`;
  }
  return `${value.toFixed(2)} ${unit}`;
}
