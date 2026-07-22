/**
 * @platform/smart-vision — concrete AutoCaptureEngine implementation.
 *
 * Orchestrates per-frame policy evaluation with:
 *   - Rate limiting  — minimum interval between successive captures
 *   - Cooldown       — post-capture quiet period
 *   - Hold           — operator-initiated pause
 *   - Policy registry — named policies, switchable at runtime
 */
import { createBuiltInPolicy } from "./capture-policies";
export function createAutoCaptureEngine(policyId, initialPolicy, cfg) {
    const registry = new Map();
    let activePolicy = initialPolicy;
    let _isOnHold = false;
    let _captureCount = 0;
    let _lastCaptureMs = 0;
    function isRateLimited() {
        if (_lastCaptureMs === 0)
            return false;
        const elapsed = Date.now() - _lastCaptureMs;
        // Enforce both minInterval AND cooldown — whichever is larger
        const required = Math.max(cfg.minIntervalMs, cfg.postCaptureCooldownMs);
        return elapsed < required;
    }
    function enforce(decision, ctx) {
        // Engine-level overrides (safety layer on top of policy)
        if (_isOnHold) {
            return {
                ...decision,
                action: "wait",
                reasons: [{ code: "manual_hold", detail: "Engine is on hold" }],
            };
        }
        if (ctx.captureLimitReached) {
            return {
                ...decision,
                action: "skip",
                reasons: [{ code: "capture_limit_reached", detail: "Session capture limit reached" }],
            };
        }
        if (decision.action === "capture" && isRateLimited()) {
            const remaining = Math.max(cfg.minIntervalMs, cfg.postCaptureCooldownMs) - (Date.now() - _lastCaptureMs);
            return {
                ...decision,
                action: "wait",
                reasons: [{ code: "rate_limited", detail: `${Math.ceil(remaining)}ms remaining`, observedValue: Date.now() - _lastCaptureMs, requiredValue: cfg.minIntervalMs }],
            };
        }
        return decision;
    }
    return {
        get policy() { return activePolicy; },
        get isOnHold() { return _isOnHold; },
        get captureCount() { return _captureCount; },
        evaluate(ctx) {
            const raw = activePolicy.evaluate(ctx);
            return enforce(raw, ctx);
        },
        setPolicy(policy) {
            activePolicy.reset();
            if (typeof policy === "string") {
                const existing = registry.get(policy);
                if (existing) {
                    activePolicy = existing;
                }
                else {
                    // Try built-in
                    activePolicy = createBuiltInPolicy(policy);
                }
            }
            else {
                activePolicy = policy;
            }
        },
        notifyCaptured(timestamp) {
            _captureCount++;
            _lastCaptureMs = timestamp;
        },
        hold() { _isOnHold = true; },
        resume() { _isOnHold = false; },
        registerPolicy(policy) {
            if (!registry.has(policy.id)) {
                registry.set(policy.id, policy);
            }
        },
        reset() {
            _captureCount = 0;
            _lastCaptureMs = 0;
            _isOnHold = false;
            activePolicy.reset();
        },
    };
}
