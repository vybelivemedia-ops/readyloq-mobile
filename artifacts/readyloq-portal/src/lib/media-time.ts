import { format } from 'date-fns';

type Timestamp = string | null | undefined;

function parseTimestamp(value: Timestamp): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Select the capture time without letting a malformed preferred value hide a valid creation time. */
export function getMediaTimestamp(capturedAt: Timestamp, createdAt: Timestamp): string | null {
  return parseTimestamp(capturedAt) ? capturedAt! : parseTimestamp(createdAt) ? createdAt! : capturedAt ?? createdAt ?? null;
}

function localCalendarDate(value: Timestamp): string | null {
  const date = parseTimestamp(value);
  return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : null;
}

/** Whether valid evidence timestamps occupy more than one browser-local calendar date. */
export function hasCrossDateMediaTimestamps(timestamps: Timestamp[]): boolean {
  const dates = new Set(timestamps.map(localCalendarDate).filter((date): date is string => date !== null));
  return dates.size > 1;
}

/**
 * Format a media tile timestamp. Time-only is sufficient for a single local
 * date; include the date when the evidence crosses midnight.
 */
export function formatMediaTileTimestamp(
  value: Timestamp,
  allTimestamps: Timestamp[],
  fallback = '—',
): string {
  const date = parseTimestamp(value);
  if (!date) return fallback;
  return format(date, hasCrossDateMediaTimestamps(allTimestamps) ? 'MMM d, h:mm a' : 'h:mm a');
}