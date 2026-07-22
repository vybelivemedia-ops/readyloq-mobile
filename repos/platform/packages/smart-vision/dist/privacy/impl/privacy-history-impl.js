/**
 * @platform/smart-vision/privacy — concrete PrivacyHistory implementation.
 *
 * In-memory append-only observation log with O(1) appends and O(n) queries.
 * Suitable for single-session use; for cross-session persistence the application
 * layer serialises via `history.query()` and stores externally.
 */
let _seq = 0;
function newObsId() {
    return `pobs-${Date.now()}-${++_seq}`;
}
export function createPrivacyHistory() {
    const log = [];
    return {
        append(record) {
            const entry = { ...record, id: newObsId() };
            log.push(entry);
            return entry;
        },
        query(q) {
            let result = [...log];
            if (q?.after !== undefined)
                result = result.filter(r => r.timestamp > q.after);
            if (q?.before !== undefined)
                result = result.filter(r => r.timestamp < q.before);
            if (q?.classId !== undefined)
                result = result.filter(r => r.object.classId === q.classId);
            if (q?.objectId !== undefined)
                result = result.filter(r => r.object.id === q.objectId);
            if (q?.redactedOnly === true)
                result = result.filter(r => r.object.redacted);
            if (q?.trigger !== undefined)
                result = result.filter(r => r.trigger === q.trigger);
            result.reverse(); // newest-first
            if (q?.limit !== undefined && q.limit > 0)
                result = result.slice(0, q.limit);
            return result;
        },
        recent(n) {
            return [...log].reverse().slice(0, n);
        },
        get size() { return log.length; },
        prune(olderThanMs) {
            const cutoff = Date.now() - olderThanMs;
            let removed = 0;
            for (let i = log.length - 1; i >= 0; i--) {
                if ((log[i]?.timestamp ?? 0) < cutoff) {
                    log.splice(i, 1);
                    removed++;
                }
            }
            return removed;
        },
        clear() {
            log.length = 0;
        },
    };
}
