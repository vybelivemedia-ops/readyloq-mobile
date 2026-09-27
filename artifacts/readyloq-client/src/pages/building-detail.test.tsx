import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';

import type { ClientInspection } from '@/hooks/use-client-portal';
import { BuildingDetail } from './building-detail';

const hooks = vi.hoisted(() => ({
  useClientInspections: vi.fn(),
  useClientReports: vi.fn(),
  useBuildingTrends: vi.fn(),
}));

vi.mock('@/hooks/use-client-portal', () => hooks);
vi.mock('@/components/evidence-gallery', () => ({
  EvidenceGallery: () => <div data-testid="evidence-gallery" />,
}));
vi.mock('@/components/PropertyMessagingWidget', () => ({
  PropertyMessagingWidget: () => null,
}));

const SIGNED_AT = '2026-08-05T10:00:00.000Z';
const SIGNED_DATE_LABEL = 'Signed Aug 5, 2026';
const BUILDING_PATH = '/buildings/123%20Signature%20Test%20Ave';

function inspection(
  id: number,
  technicianName: string,
  signature: Pick<ClientInspection, 'signedAt' | 'technicianSigned' | 'ownerSigned' | 'ownerNotAvailable'>,
): ClientInspection {
  return {
    id,
    status: 'completed',
    technicianName,
    pestTypes: [],
    severity: null,
    findingsCount: 0,
    mediaCount: 0,
    createdAt: '2026-08-05T09:00:00.000Z',
    completedAt: '2026-08-05T09:30:00.000Z',
    ...signature,
  };
}

const signatureFixtures: Array<{
  id: number;
  technicianName: string;
  label: string;
}> = [
  { id: 1, technicianName: 'Alice', label: 'Technician + owner' },
  { id: 2, technicianName: 'Bob', label: 'Technician (owner unavailable)' },
  { id: 3, technicianName: 'Carol', label: 'Technician only' },
  { id: 4, technicianName: 'Dan', label: 'Owner only' },
  { id: 5, technicianName: 'Eve', label: 'Signature on file' },
];

const inspections: ClientInspection[] = [
  inspection(1, 'Alice', {
    signedAt: SIGNED_AT,
    technicianSigned: true,
    ownerSigned: true,
    ownerNotAvailable: false,
  }),
  inspection(2, 'Bob', {
    signedAt: SIGNED_AT,
    technicianSigned: true,
    ownerSigned: false,
    ownerNotAvailable: true,
  }),
  inspection(3, 'Carol', {
    signedAt: SIGNED_AT,
    technicianSigned: true,
    ownerSigned: false,
    ownerNotAvailable: false,
  }),
  inspection(4, 'Dan', {
    signedAt: SIGNED_AT,
    technicianSigned: false,
    ownerSigned: true,
    ownerNotAvailable: false,
  }),
  inspection(5, 'Eve', {
    signedAt: SIGNED_AT,
    technicianSigned: false,
    ownerSigned: false,
    ownerNotAvailable: false,
  }),
  inspection(6, 'Frank', {
    signedAt: null,
    technicianSigned: false,
    ownerSigned: false,
    ownerNotAvailable: false,
  }),
];

function renderInspectionCards() {
  const locationHook = (): [string, (path: string, ...args: any[]) => any] => [
    BUILDING_PATH,
    () => undefined,
  ];

  render(
    <Router hook={locationHook}>
      <BuildingDetail />
    </Router>,
  );

  fireEvent.mouseDown(screen.getByRole('tab', { name: /Raw Evidence/ }), {
    button: 0,
    ctrlKey: false,
  });
}

describe('BuildingDetail signature status cards', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    hooks.useClientInspections.mockReturnValue({
      data: inspections,
      isLoading: false,
    });
    hooks.useClientReports.mockReturnValue({
      data: [],
      isLoading: false,
    });
    hooks.useBuildingTrends.mockReturnValue({
      data: { pestTrends: [], inspectionCounts: [] },
      isLoading: false,
    });
  });

  it('preserves the signed date and the exact signer label for every signed state', () => {
    renderInspectionCards();

    for (const fixture of signatureFixtures) {
      const status = screen.getByTestId(`status-signature-${fixture.id}`);
      expect(status.textContent).toContain(SIGNED_DATE_LABEL);
      expect(status.textContent).toContain(fixture.label);
    }
  });

  it('shows Awaiting signature for a completed inspection with no signature', () => {
    renderInspectionCards();

    const status = screen.getByTestId('status-signature-6');
    expect(status.textContent).toContain('Awaiting signature');
    expect(within(status).queryByText(SIGNED_DATE_LABEL)).toBeNull();
  });
});