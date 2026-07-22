"use strict";
/**
 * @platform/smart-vision/live-session — FramePipeline + PipelineEventBus implementations.
 *
 * createFramePipeline() — runs an ordered list of PipelineStageRunners sequentially.
 *   Stage errors are caught and recorded as PipelineStageResult failures; the
 *   pipeline always continues through to the last stage (event_publish) so the
 *   session always emits a pipeline.frame.processed event.
 *
 * createPipelineEventBus() — simple typed event emitter for pipeline events.
 *   All events are dispatched synchronously on the microtask queue.
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
exports.createFramePipeline = createFramePipeline;
exports.createPipelineEventBus = createPipelineEventBus;
// ─── Stage ordering ───────────────────────────────────────────────────────────
var STAGE_ORDER = {
    frame_acquisition: 0,
    stability: 1,
    quality: 2,
    scene_memory: 3,
    detection: 4,
    tracking: 5,
    motion_prediction: 6,
    smart_zoom: 7,
    privacy: 8,
    auto_capture: 9,
    event_publish: 10,
};
var STAGE_BUDGETS_MS = {
    stability: 5,
    quality: 20,
    scene_memory: 10,
    detection: 80,
    tracking: 20,
    motion_prediction: 10,
    smart_zoom: 10,
    privacy: 60,
    auto_capture: 15,
    event_publish: 1,
};
// ─── createFramePipeline ─────────────────────────────────────────────────────
function createFramePipeline(runners, sessionId) {
    // Sort ascending by stage order; mutable so replaceStage can update in place.
    var sorted = __spreadArray([], runners, true).sort(function (a, b) { var _a, _b; return ((_a = STAGE_ORDER[a.stage]) !== null && _a !== void 0 ? _a : 99) - ((_b = STAGE_ORDER[b.stage]) !== null && _b !== void 0 ? _b : 99); });
    return {
        get stages() {
            return sorted.map(function (r) {
                var _a, _b;
                return ({
                    stage: r.stage,
                    enabled: true,
                    order: (_a = STAGE_ORDER[r.stage]) !== null && _a !== void 0 ? _a : 99,
                    budgetMs: (_b = STAGE_BUDGETS_MS[r.stage]) !== null && _b !== void 0 ? _b : 50,
                });
            });
        },
        process: function (frame, context) {
            return __awaiter(this, void 0, void 0, function () {
                var pipelineStart, ctx, _i, sorted_1, runner, result, err_1;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            pipelineStart = Date.now();
                            ctx = context;
                            _i = 0, sorted_1 = sorted;
                            _b.label = 1;
                        case 1:
                            if (!(_i < sorted_1.length)) return [3 /*break*/, 7];
                            runner = sorted_1[_i];
                            result = void 0;
                            _b.label = 2;
                        case 2:
                            _b.trys.push([2, 4, , 5]);
                            return [4 /*yield*/, runner.run(frame, ctx)];
                        case 3:
                            result = _b.sent();
                            return [3 /*break*/, 5];
                        case 4:
                            err_1 = _b.sent();
                            result = {
                                stage: runner.stage,
                                ok: false,
                                latencyMs: 0,
                                data: null,
                                error: String(err_1),
                                skipped: false,
                            };
                            return [3 /*break*/, 5];
                        case 5:
                            // Thread accumulated results into the next stage's context.
                            ctx = __assign(__assign({}, ctx), { stageResults: __assign(__assign({}, ctx.stageResults), (_a = {}, _a[runner.stage] = result, _a)) });
                            _b.label = 6;
                        case 6:
                            _i++;
                            return [3 /*break*/, 1];
                        case 7: return [2 /*return*/, {
                                sessionId: sessionId,
                                frameIndex: frame.meta.index,
                                timestamp: frame.meta.timestamp,
                                ranInference: context.isInferenceFrame,
                                stages: ctx.stageResults,
                                totalLatencyMs: Date.now() - pipelineStart,
                            }];
                    }
                });
            });
        },
        notifyDropped: function (_frame, _context) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    return [2 /*return*/];
                });
            });
        },
        replaceStage: function (runner) {
            var idx = sorted.findIndex(function (r) { return r.stage === runner.stage; });
            if (idx >= 0) {
                sorted[idx] = runner;
            }
            else {
                sorted.push(runner);
                sorted.sort(function (a, b) { var _a, _b; return ((_a = STAGE_ORDER[a.stage]) !== null && _a !== void 0 ? _a : 99) - ((_b = STAGE_ORDER[b.stage]) !== null && _b !== void 0 ? _b : 99); });
            }
        },
        reset: function () {
            // No state lives in the pipeline itself — it is stateless.
        },
    };
}
// ─── createPipelineEventBus ───────────────────────────────────────────────────
function createPipelineEventBus() {
    var listeners = new Map();
    return {
        on: function (kind, listener) {
            var set = listeners.get(kind);
            if (!set) {
                set = new Set();
                listeners.set(kind, set);
            }
            var fn = listener;
            set.add(fn);
            return function () { set.delete(fn); };
        },
        off: function (kind) {
            listeners.delete(kind);
        },
        emit: function (event) {
            var set = listeners.get(event.kind);
            if (set) {
                for (var _i = 0, set_1 = set; _i < set_1.length; _i++) {
                    var fn = set_1[_i];
                    try {
                        fn(event);
                    }
                    catch ( /* listener errors must not break the pipeline */_a) { /* listener errors must not break the pipeline */ }
                }
            }
        },
        clear: function () {
            listeners.clear();
        },
    };
}
