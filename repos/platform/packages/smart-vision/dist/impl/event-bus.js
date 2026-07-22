"use strict";
/**
 * @platform/smart-vision — concrete SmartVisionEventBus implementation.
 * In-process, synchronous, typed event bus.
 */
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
exports.createEventBus = createEventBus;
function createEventBus() {
    var listeners = new Map();
    var anyListeners = [];
    function getList(kind) {
        var list = listeners.get(kind);
        if (!list) {
            list = [];
            listeners.set(kind, list);
        }
        return list;
    }
    return {
        on: function (kind, listener) {
            var list = getList(kind);
            list.push(listener);
            return function () {
                var idx = list.indexOf(listener);
                if (idx >= 0)
                    list.splice(idx, 1);
            };
        },
        onAny: function (listener) {
            anyListeners.push(listener);
            return function () {
                var idx = anyListeners.indexOf(listener);
                if (idx >= 0)
                    anyListeners.splice(idx, 1);
            };
        },
        off: function (kind) {
            listeners.delete(kind);
        },
        clear: function () {
            listeners.clear();
            anyListeners.length = 0;
        },
        emit: function (event) {
            var list = listeners.get(event.kind);
            if (list) {
                for (var _i = 0, _a = __spreadArray([], list, true); _i < _a.length; _i++) {
                    var fn = _a[_i];
                    try {
                        fn(event);
                    }
                    catch ( /* isolate listener errors */_b) { /* isolate listener errors */ }
                }
            }
            for (var _c = 0, _d = __spreadArray([], anyListeners, true); _c < _d.length; _c++) {
                var fn = _d[_c];
                try {
                    fn(event);
                }
                catch ( /* isolate listener errors */_e) { /* isolate listener errors */ }
            }
        },
    };
}
