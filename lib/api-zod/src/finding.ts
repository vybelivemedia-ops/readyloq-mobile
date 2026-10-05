/**
 * Orval emits the component inline in each operation rather than exporting a
 * reusable Finding schema. Derive the named server-side schema from the
 * generated analyze request so the API server cannot drift from openapi.yaml.
 */
import { AnalyzeInspectionBody } from "./generated/api";

const generatedFindingSchema =
  AnalyzeInspectionBody.shape.technicianFindings.unwrap().element;
const generatedMeasurementUnion =
  generatedFindingSchema.shape.measurementEstimate.unwrap();
const generatedMeasurementSchema = generatedMeasurementUnion.options[0];
const generatedCandidatesSchema =
  generatedFindingSchema.shape.candidates.unwrap();

export const FindingSchema = generatedFindingSchema.extend({
  measurementEstimate: generatedMeasurementSchema.strict().nullable().optional(),
  candidates: generatedCandidatesSchema.element.strict().array().optional(),
}).strict();