import type { Inspection } from '@workspace/api-client-react';

type InspectionListEnvelope = {
  inspections: Inspection[];
};

function isInspectionListEnvelope(value: unknown): value is InspectionListEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { inspections?: unknown }).inspections)
  );
}

export function getInspectionList(value: unknown): Inspection[] {
  if (Array.isArray(value)) return value as Inspection[];
  if (isInspectionListEnvelope(value)) return value.inspections;

  throw new TypeError('Unexpected inspection list response: expected an array or an inspections array.');
}