import { describe, expect, it } from 'vitest';
import {
  formatMediaTileTimestamp,
  getMediaTimestamp,
  hasCrossDateMediaTimestamps,
} from './media-time';

const localTimestamp = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

describe('media evidence timestamps', () => {
  it('prefers the capture timestamp, including when it is delayed from creation', () => {
    const capturedAt = '2026-08-22T12:15:00.000Z';
    expect(getMediaTimestamp(capturedAt, '2026-08-22T12:00:00.000Z')).toBe(capturedAt);
  });

  it('falls back to creation time for historical rows and malformed capture times', () => {
    const createdAt = '2024-01-03T10:00:00.000Z';
    expect(getMediaTimestamp(undefined, createdAt)).toBe(createdAt);
    expect(getMediaTimestamp('not-a-date', createdAt)).toBe(createdAt);
  });

  it('preserves the unavailable fallback when a row has no usable timestamp', () => {
    expect(getMediaTimestamp(undefined, undefined)).toBeNull();
    expect(formatMediaTileTimestamp(null, [], 'Timestamp unavailable')).toBe('Timestamp unavailable');
    expect(formatMediaTileTimestamp('not-a-date', ['not-a-date'])).toBe('—');
  });

  it('uses time-only tiles when valid evidence is on one local date', () => {
    const first = localTimestamp(2026, 8, 22, 9, 5);
    const second = localTimestamp(2026, 8, 22, 16, 30);
    expect(hasCrossDateMediaTimestamps([first, second, 'legacy value'])).toBe(false);
    expect(formatMediaTileTimestamp(first, [first, second])).toMatch(/9:05 AM/);
  });

  it('includes the local date when evidence crosses midnight', () => {
    const beforeMidnight = localTimestamp(2026, 8, 22, 23, 58);
    const afterMidnight = localTimestamp(2026, 8, 23, 0, 1);
    expect(hasCrossDateMediaTimestamps([beforeMidnight, afterMidnight])).toBe(true);
    expect(formatMediaTileTimestamp(beforeMidnight, [beforeMidnight, afterMidnight])).toMatch(/Aug 22, 11:58 PM/);
    expect(formatMediaTileTimestamp(afterMidnight, [beforeMidnight, afterMidnight])).toMatch(/Aug 23, 12:01 AM/);
  });
});