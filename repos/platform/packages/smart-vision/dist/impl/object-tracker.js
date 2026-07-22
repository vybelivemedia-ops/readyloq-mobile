"use strict";
/**
 * @platform/smart-vision — concrete ObjectTracker implementation.
 *
 * Lightweight centroid tracker. Each `acquire()` call registers a target with
 * an initial bounding box. On each `update()` call the tracker holds the last
 * known position and increments an "invisible" counter. After
 * `occlusionToleranceFrames` consecutive invisible frames the track transitions
 * to "lost". Callers (the SmartVisionEngine) re-seed the tracker by calling
 * `acquire()` with updated detection boxes on each detection frame.
 *
 * Design rationale: true optical-flow tracking in pure JS is too slow for the
 * 15-fps budget. This tracker relies on the DetectionEngine for periodic
 * position refreshes and uses dead-reckoning (via MotionPredictor) between
 * detection frames. Applications needing pixel-level optical flow should
 * provide a native-module-backed ObjectTracker via SmartVisionDependencies.
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createObjectTracker = createObjectTracker;
var DEFAULT_CONFIG = {
    maxTargets: 8,
    confidenceThreshold: 0.4,
    occlusionToleranceFrames: 5,
    predictWhenOccluded: true,
};
function ts() { return Date.now(); }
function createObjectTracker(config) {
    if (config === void 0) { config = {}; }
    var cfg = __assign(__assign({}, DEFAULT_CONFIG), config);
    var tracks = new Map();
    var _activeTracks = [];
    function buildRegion(t, fi) {
        return {
            trackId: t.target.id,
            box: t.box,
            confidence: t.confidence,
            state: t.state,
            frameIndex: fi,
            timestamp: t.timestamp,
        };
    }
    function rebuildActive(fi) {
        _activeTracks = [];
        for (var _i = 0, _a = tracks.values(); _i < _a.length; _i++) {
            var t = _a[_i];
            if (t.state !== "lost" && t.state !== "completed") {
                _activeTracks.push(buildRegion(t, fi));
            }
        }
    }
    return {
        acquire: function (target) {
            if (tracks.size >= cfg.maxTargets)
                return;
            var existing = tracks.get(target.id);
            if (existing) {
                // Re-seed with updated position (common on each detection frame)
                existing.box = target.initialBox;
                existing.confidence = 0.8;
                existing.state = "tracking";
                existing.invisibleFrames = 0;
                existing.timestamp = Date.now();
            }
            else {
                tracks.set(target.id, {
                    target: target,
                    box: target.initialBox,
                    confidence: 0.8,
                    state: "acquired",
                    frameIndex: 0,
                    timestamp: Date.now(),
                    invisibleFrames: 0,
                });
            }
        },
        release: function (trackId) {
            var t = tracks.get(trackId);
            if (t) {
                t.state = "completed";
                tracks.delete(trackId);
            }
        },
        update: function (frame) {
            return __awaiter(this, void 0, void 0, function () {
                var fi, now, _i, _a, t;
                return __generator(this, function (_b) {
                    fi = frame.meta.index;
                    now = Date.now();
                    for (_i = 0, _a = tracks.values(); _i < _a.length; _i++) {
                        t = _a[_i];
                        t.invisibleFrames++;
                        t.frameIndex = fi;
                        t.timestamp = now;
                        if (t.state === "acquired") {
                            t.state = "tracking";
                        }
                        else if (t.state === "tracking") {
                            // After a few invisible frames, mark occluded
                            if (t.invisibleFrames > 1) {
                                t.state = "occluded";
                                t.confidence = Math.max(0.1, t.confidence - 0.1 * t.invisibleFrames);
                            }
                        }
                        else if (t.state === "occluded") {
                            t.confidence = Math.max(0.05, t.confidence * 0.85);
                            if (t.invisibleFrames >= cfg.occlusionToleranceFrames) {
                                if (t.target.persistent) {
                                    // Stay occluded; engine may reacquire
                                }
                                else {
                                    t.state = "lost";
                                    tracks.delete(t.target.id);
                                }
                            }
                        }
                    }
                    rebuildActive(fi);
                    return [2 /*return*/, _activeTracks];
                });
            });
        },
        getRegion: function (trackId) {
            var t = tracks.get(trackId);
            if (!t)
                return undefined;
            return buildRegion(t, t.frameIndex);
        },
        get activeTracks() {
            return _activeTracks;
        },
        reset: function () {
            tracks.clear();
            _activeTracks = [];
        },
    };
}
