export * from "./generated/api";
export * from "./generated/types";
export * from "./finding";

// `getRouteOutlook` is the only operation with both a path param and a query
// param, which trips an orval naming collision between its zod-generated
// path-param schema (./generated/api's `GetRouteOutlookParams`, unused
// elsewhere) and the plain TS type for its query params
// (./generated/types/getRouteOutlookParams, matching the react-query
// client's `params?: GetRouteOutlookParams` signature). Re-exporting the
// type explicitly shadows the `export *` ambiguity in its favor — see
// .agents/memory/openapi-path-plus-query-collision.md.
export type { GetRouteOutlookParams } from "./generated/types/getRouteOutlookParams";
// Orval's inline request-body schemas also export inferred types with these
// names. Prefer the generated wire contracts explicitly, as for path/query.
export type { CreateFoundationLocationBody } from "./generated/types/createFoundationLocationBody";
export type { CreateFoundationVisitBody } from "./generated/types/createFoundationVisitBody";
export type { PatchFoundationCoverageBody } from "./generated/types/patchFoundationCoverageBody";
export type { PatchFoundationLocationBody } from "./generated/types/patchFoundationLocationBody";
