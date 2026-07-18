import { describe, it, expectTypeOf } from "vitest";
describe("@platform/core — type contracts", () => {
    it("Result<T,E> — ok branch carries value", () => {
        const ok = { ok: true, value: "hello" };
        expectTypeOf(ok).toMatchTypeOf();
    });
    it("Result<T,E> — error branch carries error", () => {
        const err = { ok: false, error: new RangeError("oob") };
        expectTypeOf(err).toMatchTypeOf();
    });
    it("Option<T> — some branch carries value", () => {
        const some = { some: true, value: 42 };
        expectTypeOf(some).toMatchTypeOf();
    });
    it("Option<T> — none branch has no value", () => {
        const none = { some: false };
        expectTypeOf(none).toMatchTypeOf();
    });
    it("Event<TKind, TPayload> — generic shape", () => {
        const e = {
            kind: "user.created",
            payload: { userId: "u_123" },
            timestamp: Date.now(),
        };
        expectTypeOf(e).toMatchTypeOf();
    });
    it("Command<TKind, TPayload> — carries commandId + issuedAt", () => {
        const cmd = {
            kind: "start",
            payload: { name: "job-1" },
            commandId: "cmd_abc",
            issuedAt: Date.now(),
        };
        expectTypeOf(cmd).toMatchTypeOf();
    });
    it("Brand<T,B> narrows primitive types", () => {
        const uid = "u_123";
        expectTypeOf(uid).toMatchTypeOf();
    });
    it("LifecycleState exhausts expected states", () => {
        const states = [
            "created", "initializing", "running", "stopping", "stopped", "error",
        ];
        expectTypeOf(states).toMatchTypeOf();
    });
    it.todo("Plugin.init() resolves without throwing");
    it.todo("Service start() → running, stop() → stopped");
    it.todo("Registry.register / get / unregister round-trips correctly");
    it.todo("Pipeline.execute() returns AsyncResult<TOutput>");
    it.todo("FeatureFlagRegistry.isEnabled() reflects flag state");
    it.todo("Observable.subscribe() returns a Disposable");
});
//# sourceMappingURL=core.test.js.map