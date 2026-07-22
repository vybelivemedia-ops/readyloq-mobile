"use strict";
/**
 * @platform/smart-vision — concrete FramePipeline implementation.
 * Ordered chain of FrameProcessors; isolates errors per processor.
 */
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
exports.createFramePipeline = createFramePipeline;
function createFramePipeline() {
    var processors = [];
    var processedFrames = 0;
    var droppedFrames = 0;
    var latencySum = 0;
    var peakLatencyMs = 0;
    var fpsWindowStart = Date.now();
    var fpsWindowCount = 0;
    var currentFps = 0;
    var stats = {
        get processedFrames() { return processedFrames; },
        get droppedFrames() { return droppedFrames; },
        get averageLatencyMs() { return processedFrames > 0 ? latencySum / processedFrames : 0; },
        get peakLatencyMs() { return peakLatencyMs; },
        get currentFps() { return currentFps; },
    };
    return {
        use: function (processor) {
            if (!processors.some(function (p) { return p.id === processor.id; })) {
                processors.push(processor);
            }
        },
        remove: function (processorId) {
            var idx = processors.findIndex(function (p) { return p.id === processorId; });
            if (idx >= 0)
                processors.splice(idx, 1);
        },
        run: function (frame) {
            return __awaiter(this, void 0, void 0, function () {
                var start, processorTimings, warnings, _i, _a, processor, t0, e_1, msg, durationMs, elapsed;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            start = Date.now();
                            processorTimings = {};
                            warnings = [];
                            _i = 0, _a = __spreadArray([], processors, true);
                            _b.label = 1;
                        case 1:
                            if (!(_i < _a.length)) return [3 /*break*/, 7];
                            processor = _a[_i];
                            t0 = Date.now();
                            _b.label = 2;
                        case 2:
                            _b.trys.push([2, 4, , 5]);
                            return [4 /*yield*/, processor.process(frame)];
                        case 3:
                            _b.sent();
                            return [3 /*break*/, 5];
                        case 4:
                            e_1 = _b.sent();
                            msg = e_1 instanceof Error ? e_1.message : String(e_1);
                            warnings.push("".concat(processor.id, ": ").concat(msg));
                            return [3 /*break*/, 5];
                        case 5:
                            processorTimings[processor.id] = Date.now() - t0;
                            _b.label = 6;
                        case 6:
                            _i++;
                            return [3 /*break*/, 1];
                        case 7:
                            durationMs = Date.now() - start;
                            processedFrames++;
                            latencySum += durationMs;
                            if (durationMs > peakLatencyMs)
                                peakLatencyMs = durationMs;
                            // Update rolling FPS
                            fpsWindowCount++;
                            elapsed = Date.now() - fpsWindowStart;
                            if (elapsed >= 1000) {
                                currentFps = (fpsWindowCount * 1000) / elapsed;
                                fpsWindowStart = Date.now();
                                fpsWindowCount = 0;
                            }
                            return [2 /*return*/, {
                                    frameIndex: frame.meta.index,
                                    durationMs: durationMs,
                                    processorTimings: processorTimings,
                                    warnings: warnings,
                                }];
                    }
                });
            });
        },
        reset: function () {
            for (var _i = 0, processors_1 = processors; _i < processors_1.length; _i++) {
                var p = processors_1[_i];
                p.reset();
            }
            processedFrames = 0;
            droppedFrames = 0;
            latencySum = 0;
            peakLatencyMs = 0;
            fpsWindowStart = Date.now();
            fpsWindowCount = 0;
            currentFps = 0;
        },
        get stats() { return stats; },
    };
}
