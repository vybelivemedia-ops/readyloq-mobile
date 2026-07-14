import { describe, it, expectTypeOf } from "vitest";
import type {
  Result,
  AsyncResult,
  Option,
  Disposable,
  AsyncDisposable,
  Plugin,
  Service,
  LifecycleState,
  Lifecycle,
  Registry,
  Event,
  EventHandler,
  EventSubscription,
  Command,
  Query,
  Capability,
  FeatureFlag,
  FeatureFlagRegistry,
  Provider,
  PipelineStep,
  PipelineContext,
  Pipeline,
  Observable,
  Observer,
  Brand,
  ID,
  Timestamp,
  Version,
} from "../index";

describe("@platform/core — type contracts", () => {
  it("Result<T,E> — ok branch carries value", () => {
    const ok: Result<string> = { ok: true, value: "hello" };
    expectTypeOf(ok).toMatchTypeOf<Result<string>>();
  });

  it("Result<T,E> — error branch carries error", () => {
    const err: Result<string, RangeError> = { ok: false, error: new RangeError("oob") };
    expectTypeOf(err).toMatchTypeOf<Result<string, RangeError>>();
  });

  it("Option<T> — some branch carries value", () => {
    const some: Option<number> = { some: true, value: 42 };
    expectTypeOf(some).toMatchTypeOf<Option<number>>();
  });

  it("Option<T> — none branch has no value", () => {
    const none: Option<number> = { some: false };
    expectTypeOf(none).toMatchTypeOf<Option<number>>();
  });

  it("Event<TKind, TPayload> — generic shape", () => {
    type MyEvent = Event<"user.created", { userId: string }>;
    const e: MyEvent = {
      kind: "user.created",
      payload: { userId: "u_123" },
      timestamp: Date.now(),
    };
    expectTypeOf(e).toMatchTypeOf<MyEvent>();
  });

  it("Command<TKind, TPayload> — carries commandId + issuedAt", () => {
    type StartCmd = Command<"start", { name: string }>;
    const cmd: StartCmd = {
      kind: "start",
      payload: { name: "job-1" },
      commandId: "cmd_abc",
      issuedAt: Date.now(),
    };
    expectTypeOf(cmd).toMatchTypeOf<StartCmd>();
  });

  it("Brand<T,B> narrows primitive types", () => {
    type UserId = ID<"User">;
    const uid: UserId = "u_123" as UserId;
    expectTypeOf(uid).toMatchTypeOf<string>();
  });

  it("LifecycleState exhausts expected states", () => {
    const states: LifecycleState[] = [
      "created", "initializing", "running", "stopping", "stopped", "error",
    ];
    expectTypeOf(states).toMatchTypeOf<LifecycleState[]>();
  });

  it.todo("Plugin.init() resolves without throwing");
  it.todo("Service start() → running, stop() → stopped");
  it.todo("Registry.register / get / unregister round-trips correctly");
  it.todo("Pipeline.execute() returns AsyncResult<TOutput>");
  it.todo("FeatureFlagRegistry.isEnabled() reflects flag state");
  it.todo("Observable.subscribe() returns a Disposable");
});
