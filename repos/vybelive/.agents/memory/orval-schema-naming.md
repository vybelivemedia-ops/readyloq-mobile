---
name: Orval schema naming collision
description: Avoid naming an OpenAPI component schema the same as what Orval auto-generates for the operation response.
---

## Rule
Never name an OpenAPI `components/schemas` entry `<OperationId>Response`.

**Why:** Orval auto-generates a Zod validation schema named `<OperationId>Response` for each operation's response body. If you also define a component schema with the exact same name, Orval emits the name twice in the same generated file, causing a TypeScript TS2308 "already exported" error that blocks the build.

**How to apply:** When defining a named response schema for operation `forgotPassword`, name it `ForgotPasswordPayload` (or any non-colliding name) rather than `ForgotPasswordResponse`. The `AuthResponse` schema works fine because multiple operations share it — no single operation generates `AuthResponse` as its own response schema name.
