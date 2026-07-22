"use strict";
/**
 * @platform/smart-vision — concrete SceneMemory implementation.
 *
 * In-memory observation store with:
 *   - IoU-based duplicate detection
 *   - Coverage grid (configurable rows×cols)
 *   - TTL-based freshness
 *   - Navigation hints toward unprocessed cells
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSceneMemory = createSceneMemory;
var _obsSeq = 0;
function newObsId() {
    return "obs-".concat(Date.now(), "-").concat(++_obsSeq);
}
function computeIou(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    var inter = ix * iy;
    if (inter === 0)
        return 0;
    var union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}
var DEFAULT_CONFIG = {
    coordinateSpace: "frame",
    observationTtlMs: 5 * 60 * 1000,
    overlapThreshold: 0.5,
    maxFreshObservations: 0,
    coverageGrid: { rows: 8, cols: 8 },
    navigationNoveltyThreshold: 0.3,
};
function createSceneMemory(partial) {
    if (partial === void 0) { partial = {}; }
    var config = __assign(__assign({}, DEFAULT_CONFIG), partial);
    var _a = config.coverageGrid, rows = _a.rows, cols = _a.cols;
    var observations = new Map();
    var listeners = [];
    // Coverage grid: rows×cols cells; each cell tracks freshObsCount and lastSeen
    var gridObsCount = new Array(rows * cols).fill(0);
    var gridLastSeen = new Array(rows * cols).fill(0);
    var _freshCount = 0;
    var _coverage = null;
    function emit(event) {
        for (var _i = 0, listeners_1 = listeners; _i < listeners_1.length; _i++) {
            var fn = listeners_1[_i];
            try {
                fn(event);
            }
            catch ( /* isolate */_a) { /* isolate */ }
        }
    }
    function cellIndex(row, col) { return row * cols + col; }
    function cellBox(row, col) {
        return { x: col / cols, y: row / rows, width: 1 / cols, height: 1 / rows };
    }
    function markCellsCovered(box, timestamp) {
        var _a, _b;
        // Cells that the box overlaps
        var c0 = Math.max(0, Math.floor(box.x * cols));
        var c1 = Math.min(cols - 1, Math.floor((box.x + box.width) * cols));
        var r0 = Math.max(0, Math.floor(box.y * rows));
        var r1 = Math.min(rows - 1, Math.floor((box.y + box.height) * rows));
        for (var r = r0; r <= r1; r++) {
            for (var c = c0; c <= c1; c++) {
                var idx = cellIndex(r, c);
                gridObsCount[idx] = ((_a = gridObsCount[idx]) !== null && _a !== void 0 ? _a : 0) + 1;
                gridLastSeen[idx] = Math.max((_b = gridLastSeen[idx]) !== null && _b !== void 0 ? _b : 0, timestamp);
            }
        }
    }
    function recomputeCoverage() {
        var _a, _b;
        var now = Date.now();
        var cells = [];
        var processed = 0;
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var idx = cellIndex(r, c);
                var obsCount = (_a = gridObsCount[idx]) !== null && _a !== void 0 ? _a : 0;
                var lastSeen = (_b = gridLastSeen[idx]) !== null && _b !== void 0 ? _b : 0;
                var isFresh = obsCount > 0 && (config.observationTtlMs === Infinity || now - lastSeen < config.observationTtlMs);
                if (isFresh)
                    processed++;
                cells.push(__assign(__assign({ row: r, col: c, region: cellBox(r, c), processed: isFresh }, (lastSeen > 0 ? { lastObservedAt: lastSeen } : {})), { observationCount: obsCount }));
            }
        }
        var total = rows * cols;
        return {
            processedFraction: total > 0 ? processed / total : 0,
            totalObservations: observations.size,
            freshObservations: _freshCount,
            staleObservations: observations.size - _freshCount,
            cells: cells,
            updatedAt: now,
        };
    }
    function invalidateCoverage() { _coverage = null; }
    function getFreshObservations() {
        var now = Date.now();
        return __spreadArray([], observations.values(), true).filter(function (o) { return o.fresh && (config.observationTtlMs === Infinity || now - o.timestamp < config.observationTtlMs); });
    }
    return {
        get config() { return config; },
        get freshCount() { return _freshCount; },
        get totalCount() { return observations.size; },
        record: function (entry) {
            var id = newObsId();
            var obs = __assign(__assign({}, entry), { id: id, fresh: true });
            observations.set(id, obs);
            _freshCount++;
            markCellsCovered(obs.region, obs.timestamp);
            invalidateCoverage();
            // Enforce maxFreshObservations
            if (config.maxFreshObservations > 0 && _freshCount > config.maxFreshObservations) {
                // Mark oldest fresh as stale
                for (var _i = 0, _a = observations.values(); _i < _a.length; _i++) {
                    var o = _a[_i];
                    if (o.fresh) {
                        o.fresh = false;
                        _freshCount--;
                        if (_freshCount <= config.maxFreshObservations)
                            break;
                    }
                }
            }
            emit({ kind: "observation.recorded", timestamp: Date.now(), observationId: id });
            return id;
        },
        remove: function (id) {
            var obs = observations.get(id);
            if (!obs)
                return false;
            if (obs.fresh)
                _freshCount--;
            observations.delete(id);
            invalidateCoverage();
            return true;
        },
        gc: function () {
            var now = Date.now();
            if (config.observationTtlMs === Infinity)
                return 0;
            var expired = 0;
            for (var _i = 0, _a = observations.values(); _i < _a.length; _i++) {
                var obs = _a[_i];
                if (obs.fresh && now - obs.timestamp >= config.observationTtlMs) {
                    obs.fresh = false;
                    _freshCount--;
                    expired++;
                    emit({ kind: "observation.expired", timestamp: now, observationId: obs.id });
                }
            }
            if (expired > 0)
                invalidateCoverage();
            return expired;
        },
        clear: function (options) {
            observations.clear();
            _freshCount = 0;
            gridObsCount.fill(0);
            gridLastSeen.fill(0);
            invalidateCoverage();
            emit({ kind: "memory.cleared", timestamp: Date.now() });
            void options; // anchors not implemented in this version
        },
        checkDuplicate: function (region, kinds) {
            var fresh = getFreshObservations().filter(function (o) { return kinds.length === 0 || kinds.includes(o.kind); });
            var maxOverlap = 0;
            var matching = [];
            for (var _i = 0, fresh_1 = fresh; _i < fresh_1.length; _i++) {
                var obs = fresh_1[_i];
                var iou = computeIou(region, obs.region);
                if (iou > 0) {
                    matching.push(obs);
                    if (iou > maxOverlap)
                        maxOverlap = iou;
                }
            }
            var novelty = Math.max(0, 1 - maxOverlap);
            var verdict;
            if (maxOverlap >= config.overlapThreshold) {
                verdict = "duplicate";
            }
            else if (maxOverlap > 0) {
                verdict = "partial";
            }
            else {
                verdict = "novel";
            }
            return { verdict: verdict, novelty: novelty, matchingObservations: matching, maxOverlap: maxOverlap };
        },
        novelty: function (region) {
            var fresh = getFreshObservations();
            var maxOverlap = 0;
            for (var _i = 0, fresh_2 = fresh; _i < fresh_2.length; _i++) {
                var obs = fresh_2[_i];
                var iou = computeIou(region, obs.region);
                if (iou > maxOverlap)
                    maxOverlap = iou;
            }
            return Math.max(0, 1 - maxOverlap);
        },
        query: function (options) {
            var _a, _b;
            var now = Date.now();
            var includeStale = (_a = options === null || options === void 0 ? void 0 : options.includeStale) !== null && _a !== void 0 ? _a : false;
            var limit = (_b = options === null || options === void 0 ? void 0 : options.limit) !== null && _b !== void 0 ? _b : 0;
            var result = __spreadArray([], observations.values(), true).filter(function (o) {
                var _a;
                if (!includeStale && !o.fresh)
                    return false;
                if ((options === null || options === void 0 ? void 0 : options.kinds) && !options.kinds.includes(o.kind))
                    return false;
                if ((options === null || options === void 0 ? void 0 : options.minConfidence) != null && ((_a = o.confidence) !== null && _a !== void 0 ? _a : 1) < options.minConfidence)
                    return false;
                if ((options === null || options === void 0 ? void 0 : options.trackId) && o.trackId !== options.trackId)
                    return false;
                if (options === null || options === void 0 ? void 0 : options.region) {
                    if (computeIou(o.region, options.region) === 0)
                        return false;
                }
                void now;
                return true;
            });
            // Newest-first
            result.sort(function (a, b) { return b.timestamp - a.timestamp; });
            if (limit > 0)
                result = result.slice(0, limit);
            return result;
        },
        get: function (id) {
            return observations.get(id);
        },
        get coverage() {
            if (!_coverage)
                _coverage = recomputeCoverage();
            return _coverage;
        },
        navigationHints: function (currentView) {
            var cov = this.coverage;
            var hints = [];
            var viewCx = currentView.x + currentView.width / 2;
            var viewCy = currentView.y + currentView.height / 2;
            var unprocessed = cov.cells.filter(function (c) { return !c.processed; });
            if (unprocessed.length === 0)
                return [];
            // Sort by distance from current view centre
            var withDist = unprocessed.map(function (c) {
                var cx = c.region.x + c.region.width / 2;
                var cy = c.region.y + c.region.height / 2;
                var dx = cx - viewCx;
                var dy = cy - viewCy;
                return { c: c, dx: dx, dy: dy, dist: Math.sqrt(dx * dx + dy * dy) };
            });
            withDist.sort(function (a, b) { return a.dist - b.dist; });
            var take = Math.min(3, withDist.length);
            for (var i = 0; i < take; i++) {
                var _a = withDist[i], c = _a.c, dx = _a.dx, dy = _a.dy, dist = _a.dist;
                var mag = dist > 0 ? dist : 1;
                hints.push({
                    priority: i === 0 ? "high" : i === 1 ? "medium" : "low",
                    direction: { dx: dx / mag, dy: dy / mag },
                    targetRegion: c.region,
                    unprocessedFraction: 1,
                    rationale: "Unprocessed cell at row ".concat(c.row, ", col ").concat(c.col),
                });
            }
            return hints;
        },
        snapshot: function () {
            return {
                version: 1,
                capturedAt: Date.now(),
                config: config,
                observations: __spreadArray([], observations.values(), true),
                anchors: [],
                coverage: this.coverage,
            };
        },
        restore: function (snap) {
            observations.clear();
            _freshCount = 0;
            gridObsCount.fill(0);
            gridLastSeen.fill(0);
            for (var _i = 0, _a = snap.observations; _i < _a.length; _i++) {
                var obs = _a[_i];
                observations.set(obs.id, __assign({}, obs));
                if (obs.fresh)
                    _freshCount++;
                markCellsCovered(obs.region, obs.timestamp);
            }
            invalidateCoverage();
            emit({ kind: "memory.restored", timestamp: Date.now() });
        },
        on: function (listener) {
            listeners.push(listener);
            return function () {
                var idx = listeners.indexOf(listener);
                if (idx >= 0)
                    listeners.splice(idx, 1);
            };
        },
    };
}
