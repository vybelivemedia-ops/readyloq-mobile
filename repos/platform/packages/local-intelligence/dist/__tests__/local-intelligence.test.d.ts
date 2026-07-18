/**
 * @platform/local-intelligence — Unit Test Stubs
 *
 * This package exports interfaces only. These tests serve two purposes:
 *
 *   1. TYPE COMPATIBILITY TESTS — Verify that mock implementations satisfy
 *      the exported interfaces at compile time. If TypeScript accepts these
 *      mocks, the interface contracts are well-formed.
 *
 *   2. IMPLEMENTATION GUIDANCE — Document the expected behavioural contracts
 *      that concrete implementations (TFLite adapter, ONNX adapter, etc.)
 *      must honour. Each test that is marked `test.todo` becomes a real test
 *      when the implementation is extracted from the app.
 *
 * HOW TO USE WHEN IMPLEMENTING:
 *   1. Create an implementation file (e.g. src/adapters/tflite-adapter.ts)
 *   2. Replace the mocks below with the real implementation
 *   3. Replace test.todo blocks with real assertions
 *   4. Run: pnpm --filter @platform/local-intelligence test
 */
export {};
//# sourceMappingURL=local-intelligence.test.d.ts.map