"use strict";
/**
 * @platform/smart-vision — concrete FrameBuffer implementation.
 * Fixed-capacity ring buffer. Oldest frames are silently evicted on overflow.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFrameBuffer = createFrameBuffer;
function ringIdx(pos, cap) {
    return ((pos % cap) + cap) % cap;
}
function createFrameBuffer(capacity) {
    if (capacity < 1)
        throw new RangeError("FrameBuffer capacity must be >= 1");
    var ring = new Array(capacity);
    var head = 0; // next write position
    var count = 0;
    return {
        get length() { return count; },
        get capacity() { return capacity; },
        push: function (frame) {
            ring[head] = frame;
            head = (head + 1) % capacity;
            if (count < capacity)
                count++;
            // else oldest was silently evicted
        },
        peek: function (n) {
            var take = Math.min(Math.max(0, n), count);
            var frames = [];
            for (var i = 0; i < take; i++) {
                // head - take + i gives oldest → newest order
                var f = ring[ringIdx(head - take + i, capacity)];
                if (f !== undefined)
                    frames.push(f);
            }
            return frames;
        },
        drain: function () {
            var frames = [];
            for (var i = 0; i < count; i++) {
                var f = ring[ringIdx(head - count + i, capacity)];
                if (f !== undefined)
                    frames.push(f);
            }
            count = 0;
            head = 0;
            return frames;
        },
        clear: function () {
            count = 0;
            head = 0;
        },
    };
}
