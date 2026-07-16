/**
 * @platform/smart-vision — concrete FrameBuffer implementation.
 * Fixed-capacity ring buffer. Oldest frames are silently evicted on overflow.
 */

import type { FrameBuffer, VideoFrame } from "../frame";

function ringIdx(pos: number, cap: number): number {
  return ((pos % cap) + cap) % cap;
}

export function createFrameBuffer(capacity: number): FrameBuffer {
  if (capacity < 1) throw new RangeError("FrameBuffer capacity must be >= 1");

  const ring: (VideoFrame | undefined)[] = new Array(capacity);
  let head = 0; // next write position
  let count = 0;

  return {
    get length() { return count; },
    get capacity() { return capacity; },

    push(frame: VideoFrame): void {
      ring[head] = frame;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
      // else oldest was silently evicted
    },

    peek(n: number): readonly VideoFrame[] {
      const take = Math.min(Math.max(0, n), count);
      const frames: VideoFrame[] = [];
      for (let i = 0; i < take; i++) {
        // head - take + i gives oldest → newest order
        const f = ring[ringIdx(head - take + i, capacity)];
        if (f !== undefined) frames.push(f);
      }
      return frames;
    },

    drain(): VideoFrame[] {
      const frames: VideoFrame[] = [];
      for (let i = 0; i < count; i++) {
        const f = ring[ringIdx(head - count + i, capacity)];
        if (f !== undefined) frames.push(f);
      }
      count = 0;
      head = 0;
      return frames;
    },

    clear(): void {
      count = 0;
      head = 0;
    },
  };
}
