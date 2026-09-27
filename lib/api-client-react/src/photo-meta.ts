/**
 * Presentation-ready metadata shared by the mobile and company-portal
 * evidence galleries.
 */
export interface PhotoMeta {
  id: string | number;
  url: string;
  classificationTag: string;
  confidenceScore: number | null;
  technicianCorrectionLabel: string | null;
  structuredDescription: string | null;
  chemicalLogReference: string | null;
  unitNumber: string | null;
  capturedAt: string | null;
}