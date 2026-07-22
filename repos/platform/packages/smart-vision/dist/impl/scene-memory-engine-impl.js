"use strict";
/**
 * @platform/smart-vision — concrete SceneMemoryEngine implementation.
 *
 * Composes five in-memory sub-registries into one coherent scene-understanding
 * API. All registries are single-session, in-memory, and serialisable via
 * `getSceneSummary()`.
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
exports.createSceneMemoryEngine = createSceneMemoryEngine;
// ─── ID factories ─────────────────────────────────────────────────────────────
var _seq = 0;
var uid = function () { return "".concat(Date.now(), "-").concat(++_seq); };
var objId = function () { return "obj-".concat(uid()); };
var zoneId = function () { return "zone-".concat(uid()); };
var obsId = function () { return "orec-".concat(uid()); };
var capId = function () { return "crec-".concat(uid()); };
var measId = function () { return "mrec-".concat(uid()); };
// ─── IoU helper ───────────────────────────────────────────────────────────────
function iou(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    var inter = ix * iy;
    if (inter === 0)
        return 0;
    var union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}
// ─── ObjectRegistry ───────────────────────────────────────────────────────────
function makeObjectRegistry(mergeIou) {
    var records = new Map();
    return {
        findById: function (id) { return records.get(id); },
        findByClassId: function (classId) {
            return __spreadArray([], records.values(), true).filter(function (r) { return r.classId === classId; })
                .sort(function (a, b) { return b.lastSeenAt - a.lastSeenAt; });
        },
        findNear: function (box, threshold) {
            if (threshold === void 0) { threshold = 0.3; }
            return __spreadArray([], records.values(), true).filter(function (r) { return r.lastKnownBox && iou(box, r.lastKnownBox) >= threshold; });
        },
        findInZone: function (zId) {
            return __spreadArray([], records.values(), true).filter(function (r) { return r.lastZoneId === zId; });
        },
        all: function () {
            return __spreadArray([], records.values(), true).sort(function (a, b) { return b.lastSeenAt - a.lastSeenAt; });
        },
        upsert: function (detection) {
            var _a, _b;
            // Find a matching existing record (same classId + IoU overlap)
            var best = null;
            var bestIou = mergeIou - 0.001;
            for (var _i = 0, _c = records.values(); _i < _c.length; _i++) {
                var r = _c[_i];
                if (r.classId !== detection.classId)
                    continue;
                if (!r.lastKnownBox)
                    continue;
                var score = iou(detection.box, r.lastKnownBox);
                if (score > bestIou) {
                    best = r;
                    bestIou = score;
                }
            }
            if (best) {
                best.lastSeenAt = detection.timestamp;
                best.observationCount++;
                best.lastKnownBox = detection.box;
                best.meanConfidence = (best.meanConfidence * (best.observationCount - 1) + detection.confidence) / best.observationCount;
                if (detection.trackId)
                    best.activeTrackId = detection.trackId;
                if (detection.zoneId)
                    best.lastZoneId = detection.zoneId;
                return best;
            }
            var record = {
                id: objId(),
                classId: detection.classId,
                firstSeenAt: detection.timestamp,
                lastSeenAt: detection.timestamp,
                observationCount: 1,
                lastKnownBox: detection.box,
                meanConfidence: detection.confidence,
                lastZoneId: (_a = detection.zoneId) !== null && _a !== void 0 ? _a : null,
                activeTrackId: (_b = detection.trackId) !== null && _b !== void 0 ? _b : null,
                captured: false,
                capturedAt: null,
            };
            records.set(record.id, record);
            return record;
        },
        markCaptured: function (id, timestamp) {
            var r = records.get(id);
            if (r) {
                r.captured = true;
                r.capturedAt = timestamp;
            }
        },
        clear: function () { records.clear(); },
        get size() { return records.size; },
    };
}
// ─── SpatialMap ───────────────────────────────────────────────────────────────
function makeSpatialMap() {
    var zones = new Map();
    function emptyZone(def) {
        return __assign(__assign({}, def), { observed: false, firstObservedAt: null, lastObservedAt: null, totalObservedMs: 0, observationCount: 0, captureCount: 0 });
    }
    return {
        defineZone: function (zone) {
            if (!zones.has(zone.id))
                zones.set(zone.id, emptyZone(zone));
        },
        zones: function () { return __spreadArray([], zones.values(), true); },
        getZone: function (id) { return zones.get(id); },
        markObserved: function (zoneId, durationMs, timestamp) {
            var _a;
            var z = zones.get(zoneId);
            if (!z)
                return;
            z.observed = true;
            z.firstObservedAt = (_a = z.firstObservedAt) !== null && _a !== void 0 ? _a : timestamp;
            z.lastObservedAt = timestamp;
            z.totalObservedMs += durationMs;
            z.observationCount++;
        },
        markCaptured: function (zoneId, _ts) {
            var z = zones.get(zoneId);
            if (z)
                z.captureCount++;
        },
        getCoverage: function () {
            var all = __spreadArray([], zones.values(), true);
            var now = Date.now();
            var processed = all.filter(function (z) { return z.observed; }).length;
            return {
                processedFraction: all.length > 0 ? processed / all.length : 0,
                totalObservations: all.reduce(function (s, z) { return s + z.observationCount; }, 0),
                freshObservations: processed,
                staleObservations: all.length - processed,
                cells: all.map(function (z, i) { return (__assign(__assign({ row: i, col: 0, region: { x: 0, y: i / all.length, width: 1, height: 1 / (all.length || 1) }, processed: z.observed }, (z.lastObservedAt != null ? { lastObservedAt: z.lastObservedAt } : {})), { observationCount: z.observationCount })); }),
                updatedAt: now,
            };
        },
        getNavigationHints: function (limit) {
            if (limit === void 0) { limit = 3; }
            var unvisited = __spreadArray([], zones.values(), true).filter(function (z) { return !z.observed; })
                .sort(function (a, b) { return b.navigationPriority - a.navigationPriority; })
                .slice(0, limit);
            return unvisited.map(function (z, i) { return ({
                priority: i === 0 ? "high" : i === 1 ? "medium" : "low",
                direction: { dx: 0, dy: 1 },
                targetRegion: null,
                unprocessedFraction: 1,
                rationale: "Zone \"".concat(z.label, "\" not yet observed"),
            }); });
        },
        resolveZone: function (box) {
            var _a;
            // Find the zone whose region most overlaps with the box
            // Zones defined without a region — match by label/priority order
            var best = null;
            for (var _i = 0, _b = zones.values(); _i < _b.length; _i++) {
                var z = _b[_i];
                if (!best || z.navigationPriority > best.navigationPriority)
                    best = z;
            }
            return (_a = best === null || best === void 0 ? void 0 : best.id) !== null && _a !== void 0 ? _a : null;
        },
        resetObservations: function () {
            for (var _i = 0, _a = zones.values(); _i < _a.length; _i++) {
                var z = _a[_i];
                z.observed = false;
                z.firstObservedAt = null;
                z.lastObservedAt = null;
                z.totalObservedMs = 0;
                z.observationCount = 0;
                z.captureCount = 0;
            }
        },
    };
}
// ─── ObservationHistory ───────────────────────────────────────────────────────
function makeObservationHistory(ttlMs) {
    var log = [];
    return {
        append: function (record) {
            var r = __assign(__assign({}, record), { id: obsId() });
            log.push(r);
            return r;
        },
        query: function (q) {
            var result = __spreadArray([], log, true);
            if (q === null || q === void 0 ? void 0 : q.after)
                result = result.filter(function (r) { return r.timestamp > q.after; });
            if (q === null || q === void 0 ? void 0 : q.before)
                result = result.filter(function (r) { return r.timestamp < q.before; });
            if ((q === null || q === void 0 ? void 0 : q.classId) != null)
                result = result.filter(function (r) { return r.classIds.includes(q.classId); });
            if (q === null || q === void 0 ? void 0 : q.zoneId)
                result = result.filter(function (r) { return r.zoneId === q.zoneId; });
            result.reverse(); // newest first
            if ((q === null || q === void 0 ? void 0 : q.limit) && q.limit > 0)
                result = result.slice(0, q.limit);
            return result;
        },
        recent: function (n) {
            return __spreadArray([], log, true).reverse().slice(0, n);
        },
        get size() { return log.length; },
        prune: function (olderThanMs) {
            var _a, _b;
            var cutoff = Date.now() - olderThanMs;
            var removed = 0;
            for (var i = log.length - 1; i >= 0; i--) {
                if (((_b = (_a = log[i]) === null || _a === void 0 ? void 0 : _a.timestamp) !== null && _b !== void 0 ? _b : 0) < cutoff) {
                    log.splice(i, 1);
                    removed++;
                }
            }
            return removed;
        },
        clear: function () { log.length = 0; },
    };
}
// ─── CaptureHistory ───────────────────────────────────────────────────────────
function makeCaptureHistory() {
    var log = [];
    return {
        append: function (record) {
            var r = __assign(__assign({}, record), { id: capId() });
            log.push(r);
            return r;
        },
        findByEvidenceId: function (evidenceId) {
            return log.find(function (r) { return r.evidenceId === evidenceId; });
        },
        query: function (q) {
            var result = __spreadArray([], log, true);
            if (q === null || q === void 0 ? void 0 : q.after)
                result = result.filter(function (r) { return r.timestamp > q.after; });
            if (q === null || q === void 0 ? void 0 : q.before)
                result = result.filter(function (r) { return r.timestamp < q.before; });
            if (q === null || q === void 0 ? void 0 : q.trigger)
                result = result.filter(function (r) { return r.trigger === q.trigger; });
            if (q === null || q === void 0 ? void 0 : q.zoneId)
                result = result.filter(function (r) { return r.zoneId === q.zoneId; });
            result.reverse();
            if ((q === null || q === void 0 ? void 0 : q.limit) && q.limit > 0)
                result = result.slice(0, q.limit);
            return result;
        },
        recent: function (n) {
            return __spreadArray([], log, true).reverse().slice(0, n);
        },
        get size() { return log.length; },
        get totalCaptured() { return log.length; },
        confirmEvidence: function (id, evidenceId) {
            var r = log.find(function (r) { return r.id === id; });
            if (r)
                r.evidenceId = evidenceId;
        },
        clear: function () { log.length = 0; },
    };
}
// ─── MeasurementHistory ───────────────────────────────────────────────────────
function makeMeasurementHistory() {
    var log = [];
    return {
        append: function (record) {
            var r = __assign(__assign({}, record), { id: measId() });
            log.push(r);
            return r;
        },
        query: function (q) {
            var result = __spreadArray([], log, true);
            if (q === null || q === void 0 ? void 0 : q.after)
                result = result.filter(function (r) { return r.timestamp > q.after; });
            if (q === null || q === void 0 ? void 0 : q.before)
                result = result.filter(function (r) { return r.timestamp < q.before; });
            if (q === null || q === void 0 ? void 0 : q.dimension)
                result = result.filter(function (r) { return r.dimension === q.dimension; });
            if (q === null || q === void 0 ? void 0 : q.zoneId)
                result = result.filter(function (r) { return r.zoneId === q.zoneId; });
            if (q === null || q === void 0 ? void 0 : q.objectId)
                result = result.filter(function (r) { return r.objectId === q.objectId; });
            result.reverse();
            if ((q === null || q === void 0 ? void 0 : q.limit) && q.limit > 0)
                result = result.slice(0, q.limit);
            return result;
        },
        recent: function (n) {
            return __spreadArray([], log, true).reverse().slice(0, n);
        },
        latestFor: function (dimension) {
            var _a;
            for (var i = log.length - 1; i >= 0; i--) {
                if (((_a = log[i]) === null || _a === void 0 ? void 0 : _a.dimension) === dimension)
                    return log[i];
            }
            return undefined;
        },
        latestForZone: function (dimension, zId) {
            for (var i = log.length - 1; i >= 0; i--) {
                var r = log[i];
                if ((r === null || r === void 0 ? void 0 : r.dimension) === dimension && r.zoneId === zId)
                    return r;
            }
            return undefined;
        },
        get size() { return log.length; },
        prune: function (olderThanMs) {
            var _a, _b;
            var cutoff = Date.now() - olderThanMs;
            var removed = 0;
            for (var i = log.length - 1; i >= 0; i--) {
                if (((_b = (_a = log[i]) === null || _a === void 0 ? void 0 : _a.timestamp) !== null && _b !== void 0 ? _b : 0) < cutoff) {
                    log.splice(i, 1);
                    removed++;
                }
            }
            return removed;
        },
        clear: function () { log.length = 0; },
    };
}
// ─── SceneMemoryEngine ────────────────────────────────────────────────────────
function createSceneMemoryEngine(partial) {
    var _a, _b, _c, _d;
    if (partial === void 0) { partial = {}; }
    var config = {
        observationTtlMs: (_a = partial.observationTtlMs) !== null && _a !== void 0 ? _a : 30 * 60 * 1000,
        objectMergeIouThreshold: (_b = partial.objectMergeIouThreshold) !== null && _b !== void 0 ? _b : 0.3,
        maxObjectsPerClass: (_c = partial.maxObjectsPerClass) !== null && _c !== void 0 ? _c : 0,
        persistAcrossSessions: (_d = partial.persistAcrossSessions) !== null && _d !== void 0 ? _d : false,
    };
    var _objects = makeObjectRegistry(config.objectMergeIouThreshold);
    var _spatial = makeSpatialMap();
    var _observations = makeObservationHistory(config.observationTtlMs);
    var _captures = makeCaptureHistory();
    var _measurements = makeMeasurementHistory();
    var eventListeners = new Map();
    function emit(kind, payload) {
        var _a;
        var ts = Date.now();
        var list = (_a = eventListeners.get(kind)) !== null && _a !== void 0 ? _a : [];
        var evt = payload !== undefined ? { kind: kind, timestamp: ts, payload: payload } : { kind: kind, timestamp: ts };
        for (var _i = 0, list_1 = list; _i < list_1.length; _i++) {
            var fn = list_1[_i];
            try {
                fn(evt);
            }
            catch ( /* isolate */_b) { /* isolate */ }
        }
    }
    return {
        get config() { return config; },
        get objects() { return _objects; },
        get spatial() { return _spatial; },
        get observations() { return _observations; },
        get captures() { return _captures; },
        get measurements() { return _measurements; },
        isRecentlyCaptured: function (box, windowMs) {
            if (windowMs === void 0) { windowMs = 30000; }
            var since = (Date.now() - windowMs);
            var recent = _captures.query({ after: since });
            if (recent.length === 0)
                return false;
            var nearObjects = _objects.all().filter(function (r) { return r.captured && r.capturedAt && r.capturedAt > since && r.lastKnownBox && iou(box, r.lastKnownBox) >= 0.3; });
            return nearObjects.length > 0;
        },
        getSceneSummary: function () {
            var coverage = _spatial.getCoverage();
            var navigationHints = _spatial.getNavigationHints(3);
            var uncapturedObjects = _objects.all().filter(function (r) { return !r.captured; }).sort(function (a, b) { return b.meanConfidence - a.meanConfidence; });
            return {
                coverage: coverage,
                navigationHints: navigationHints,
                uncapturedObjects: uncapturedObjects,
                totalObjects: _objects.size,
                totalCaptures: _captures.size,
                totalObservations: _observations.size,
            };
        },
        resetSession: function () {
            _observations.clear();
            _captures.clear();
            _spatial.resetObservations();
            if (!config.persistAcrossSessions)
                _objects.clear();
        },
        reset: function () {
            _objects.clear();
            _spatial.resetObservations();
            _observations.clear();
            _captures.clear();
            _measurements.clear();
        },
        on: function (kind, listener) {
            var list = eventListeners.get(kind);
            if (!list) {
                list = [];
                eventListeners.set(kind, list);
            }
            list.push(listener);
            return function () {
                var l = eventListeners.get(kind);
                if (l) {
                    var i = l.indexOf(listener);
                    if (i >= 0)
                        l.splice(i, 1);
                }
            };
        },
        off: function (kind) {
            eventListeners.delete(kind);
        },
    };
}
