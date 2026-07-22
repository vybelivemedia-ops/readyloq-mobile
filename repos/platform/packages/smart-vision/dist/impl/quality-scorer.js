"use strict";
/**
 * @platform/smart-vision — concrete QualityScorer implementation.
 *
 * Scores live VideoFrames across resolution, sharpness, and exposure
 * dimensions. All thresholds are injectable via QualityScorerConfig.
 *
 * Dimensions implemented:
 *   resolution  — short-edge pixel count vs. configured minimum
 *   sharpness   — Laplacian variance on the Y-plane (pixel quality path)
 *   exposure    — mean luminance histogram (pixel quality path)
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
exports.createQualityScorer = createQualityScorer;
// ─── Built-in defaults ────────────────────────────────────────────────────────
var MIN_SHORT_EDGE_PX = 480;
var GOOD_SHORT_EDGE_PX = 960;
var SHARP_VARIANCE = 140;
var BLUR_VARIANCE = 12;
var MAX_SHARP_PENALTY = 35;
// Exposure: mean Y below LOW = dark; above HIGH = blown out
var EXPOSURE_LOW = 40;
var EXPOSURE_HIGH = 215;
var EXPOSURE_DARK_PENALTY = 40;
var EXPOSURE_BLOWN_PENALTY = 20;
// ─── Y-plane extraction ───────────────────────────────────────────────────────
function extractY(frame) {
    var _a = frame.meta.dimensions, width = _a.width, height = _a.height;
    var src = frame.data;
    switch (frame.pixelFormat) {
        case "gray8":
            return src instanceof Uint8Array ? src : new Uint8Array(src);
        case "yuv420p":
        case "nv12":
            return new Uint8Array(src.buffer, src.byteOffset, width * height);
        case "rgb8": {
            var y = new Uint8Array(width * height);
            for (var i = 0; i < width * height; i++) {
                y[i] = ((src[i * 3] * 77 + src[i * 3 + 1] * 150 + src[i * 3 + 2] * 29) >>> 8);
            }
            return y;
        }
        case "rgba8": {
            var y = new Uint8Array(width * height);
            for (var i = 0; i < width * height; i++) {
                y[i] = ((src[i * 4] * 77 + src[i * 4 + 1] * 150 + src[i * 4 + 2] * 29) >>> 8);
            }
            return y;
        }
        default:
            return null;
    }
}
// ─── Laplacian variance ───────────────────────────────────────────────────────
function laplacianVariance(y, width, height) {
    if (width < 3 || height < 3)
        return null;
    var n = (width - 2) * (height - 2);
    var sum = 0;
    var sumSq = 0;
    for (var row = 1; row < height - 1; row++) {
        for (var col = 1; col < width - 1; col++) {
            var c = y[row * width + col];
            var v = (y[(row - 1) * width + col] +
                y[(row + 1) * width + col] +
                y[row * width + col - 1] +
                y[row * width + col + 1] -
                4 * c);
            sum += v;
            sumSq += v * v;
        }
    }
    var mean = sum / n;
    return sumSq / n - mean * mean;
}
// ─── Exposure mean ────────────────────────────────────────────────────────────
function meanLuminance(y, step) {
    if (step === void 0) { step = 4; }
    var sum = 0;
    var count = 0;
    for (var i = 0; i < y.length; i += step) {
        sum += y[i];
        count++;
    }
    return count > 0 ? sum / count : 128;
}
// ─── Dimension builders ───────────────────────────────────────────────────────
function scoreResolution(width, height, minEdge) {
    var shortEdge = Math.min(width, height);
    if (shortEdge >= GOOD_SHORT_EDGE_PX) {
        return { dim: { kind: "resolution", value: shortEdge, score: 100, penalty: 0 } };
    }
    if (shortEdge < minEdge) {
        var penalty_1 = 45;
        return {
            dim: { kind: "resolution", value: shortEdge, score: Math.max(0, 100 - penalty_1), penalty: penalty_1 },
            advisory: { dimension: "resolution", severity: "critical", message: "Very low resolution (".concat(width, "\u00D7").concat(height, ")") },
        };
    }
    var t = (GOOD_SHORT_EDGE_PX - shortEdge) / (GOOD_SHORT_EDGE_PX - minEdge);
    var penalty = Math.round(20 * t);
    return __assign({ dim: { kind: "resolution", value: shortEdge, score: Math.max(0, 100 - penalty), penalty: penalty } }, (penalty > 0 ? { advisory: { dimension: "resolution", severity: "warning", message: "Resolution may limit detail (short edge: ".concat(shortEdge, "px)") } } : {}));
}
function scoreSharpness(y, width, height, blurThreshold) {
    var v = laplacianVariance(y, width, height);
    if (v == null)
        return null;
    if (v >= SHARP_VARIANCE) {
        return { dim: { kind: "sharpness", value: v, score: 100, penalty: 0 } };
    }
    if (v <= blurThreshold) {
        return {
            dim: { kind: "sharpness", value: v, score: Math.max(0, 100 - MAX_SHARP_PENALTY), penalty: MAX_SHARP_PENALTY },
            advisory: { dimension: "sharpness", severity: "warning", message: "Image appears out of focus or blurry" },
        };
    }
    var t = (SHARP_VARIANCE - v) / (SHARP_VARIANCE - blurThreshold);
    var penalty = Math.round(MAX_SHARP_PENALTY * t);
    return __assign({ dim: { kind: "sharpness", value: v, score: Math.max(0, 100 - penalty), penalty: penalty } }, (penalty >= MAX_SHARP_PENALTY / 2 ? { advisory: { dimension: "sharpness", severity: "warning", message: "Image may be slightly out of focus" } } : {}));
}
function scoreExposure(y) {
    var mean = meanLuminance(y);
    if (mean < EXPOSURE_LOW) {
        return {
            dim: { kind: "exposure", value: mean, score: Math.max(0, 100 - EXPOSURE_DARK_PENALTY), penalty: EXPOSURE_DARK_PENALTY },
            advisory: { dimension: "exposure", severity: "warning", message: "Scene appears too dark — increase lighting" },
        };
    }
    if (mean > EXPOSURE_HIGH) {
        return {
            dim: { kind: "exposure", value: mean, score: Math.max(0, 100 - EXPOSURE_BLOWN_PENALTY), penalty: EXPOSURE_BLOWN_PENALTY },
            advisory: { dimension: "exposure", severity: "warning", message: "Scene may be overexposed — reduce glare" },
        };
    }
    return { dim: { kind: "exposure", value: mean, score: 100, penalty: 0 } };
}
// ─── Report assembly ─────────────────────────────────────────────────────────
var SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
function assemble(dims, advisories, threshold) {
    var overall = Math.max(0, Math.min(100, 100 - dims.reduce(function (s, d) { return s + d.penalty; }, 0)));
    var sorted = __spreadArray([], advisories, true).sort(function (a, b) { return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]; });
    return { overall: overall, acceptable: overall >= threshold, dimensions: dims, advisories: sorted };
}
// ─── Factory ─────────────────────────────────────────────────────────────────
var DEFAULT_CONFIG = {
    acceptanceThreshold: 50,
    thresholds: {
        resolution: MIN_SHORT_EDGE_PX,
        sharpness: BLUR_VARIANCE,
    },
    enablePixelAnalysis: true,
};
/**
 * Create the platform-level QualityScorer.
 *
 * This is the canonical implementation. Applications may substitute their own
 * scorer via SmartVisionDependencies.qualityScorer.
 */
function createQualityScorer(config) {
    var _a, _b, _c, _d;
    if (config === void 0) { config = {}; }
    var cfg = {
        acceptanceThreshold: (_a = config.acceptanceThreshold) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG.acceptanceThreshold,
        thresholds: __assign(__assign({}, DEFAULT_CONFIG.thresholds), config.thresholds),
        enablePixelAnalysis: (_b = config.enablePixelAnalysis) !== null && _b !== void 0 ? _b : DEFAULT_CONFIG.enablePixelAnalysis,
    };
    var minEdge = (_c = cfg.thresholds.resolution) !== null && _c !== void 0 ? _c : MIN_SHORT_EDGE_PX;
    var blurThreshold = (_d = cfg.thresholds.sharpness) !== null && _d !== void 0 ? _d : BLUR_VARIANCE;
    return {
        config: cfg,
        scoreMetadata: function (frame) {
            var _a = frame.meta.dimensions, width = _a.width, height = _a.height;
            var _b = scoreResolution(width, height, minEdge), dim = _b.dim, advisory = _b.advisory;
            return assemble([dim], advisory ? [advisory] : [], cfg.acceptanceThreshold);
        },
        score: function (frame) {
            return __awaiter(this, void 0, void 0, function () {
                var _a, width, height, dims, advisories, res, y, sharp, exp;
                return __generator(this, function (_b) {
                    _a = frame.meta.dimensions, width = _a.width, height = _a.height;
                    dims = [];
                    advisories = [];
                    res = scoreResolution(width, height, minEdge);
                    dims.push(res.dim);
                    if (res.advisory)
                        advisories.push(res.advisory);
                    // Pixel-level analysis
                    if (cfg.enablePixelAnalysis) {
                        y = extractY(frame);
                        if (y) {
                            sharp = scoreSharpness(y, width, height, blurThreshold);
                            if (sharp) {
                                dims.push(sharp.dim);
                                if (sharp.advisory)
                                    advisories.push(sharp.advisory);
                            }
                            exp = scoreExposure(y);
                            dims.push(exp.dim);
                            if (exp.advisory)
                                advisories.push(exp.advisory);
                        }
                    }
                    return [2 /*return*/, assemble(dims, advisories, cfg.acceptanceThreshold)];
                });
            });
        },
    };
}
