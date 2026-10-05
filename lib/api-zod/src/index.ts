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
