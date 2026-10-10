import { describe, expect, it } from 'vitest';
import type { Inspection } from '@workspace/api-client-react';
import { getInspectionList } from './list-response';

const inspection: Inspection = {
  id: 42,
  siteAddress: '123 Market Street',
  technicianName: 'Morgan Lee',
  status: 'completed',
  createdAt: '2026-08-22T12:00:00.000Z',
};

describe('getInspectionList', () => {
  it('unwraps the current inspections response envelope before the list renders rows', () => {
    expect(getInspectionList({ inspections: [inspection] })).toEqual([inspection]);
  });

  it('continues to support the generated client array response', () => {
    expect(getInspectionList([inspection])).toEqual([inspection]);
  });
});