"use strict";
/**
 * @platform/smart-vision/privacy — concrete PrivacyHistory implementation.
 *
 * In-memory append-only observation log with O(1) appends and O(n) queries.
 * Suitable for single-session use; for cross-session persistence the application
 * layer serialises via `history.query()` and stores externally.
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
exports.createPrivacyHistory = createPrivacyHistory;
var _seq = 0;
function newObsId() {
    return "pobs-".concat(Date.now(), "-").concat(++_seq);
}
function createPrivacyHistory() {
    var log = [];
    return {
        append: function (record) {
            var entry = __assign(__assign({}, record), { id: newObsId() });
            log.push(entry);
            return entry;
        },
        query: function (q) {
            var result = __spreadArray([], log, true);
            if ((q === null || q === void 0 ? void 0 : q.after) !== undefined)
                result = result.filter(function (r) { return r.timestamp > q.after; });
            if ((q === null || q === void 0 ? void 0 : q.before) !== undefined)
                result = result.filter(function (r) { return r.timestamp < q.before; });
            if ((q === null || q === void 0 ? void 0 : q.classId) !== undefined)
                result = result.filter(function (r) { return r.object.classId === q.classId; });
            if ((q === null || q === void 0 ? void 0 : q.objectId) !== undefined)
                result = result.filter(function (r) { return r.object.id === q.objectId; });
            if ((q === null || q === void 0 ? void 0 : q.redactedOnly) === true)
                result = result.filter(function (r) { return r.object.redacted; });
            if ((q === null || q === void 0 ? void 0 : q.trigger) !== undefined)
                result = result.filter(function (r) { return r.trigger === q.trigger; });
            result.reverse(); // newest-first
            if ((q === null || q === void 0 ? void 0 : q.limit) !== undefined && q.limit > 0)
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
        clear: function () {
            log.length = 0;
        },
    };
}
