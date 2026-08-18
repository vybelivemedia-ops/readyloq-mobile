/**
 * PestPac (WorkWave) SOAP/XML adapter.
 *
 * PestPac's legacy Route Manager endpoint accepts SOAP 1.1 XML envelopes for
 * inspection record writes. This adapter builds the envelope from the
 * EnterpriseSyncPayload and POSTs it to the configured SOAP endpoint.
 *
 * Auth: X-WorkWave-Key UUID header on every request.
 * Endpoint: PESTPAC_SOAP_BASE_URL env var, default https://api.workwave.com/pestpac/v1/soap
 */

import type { EnterpriseSyncPayload } from "../../../types/enterprise-payload";
import { ssrfSafeFetch } from "../../../lib/ssrf-safe-fetch";

const PESTPAC_SOAP_DEFAULT_BASE = "https://api.workwave.com/pestpac/v1/soap";

export interface PestPacSoapConfig {
  apiKey: string;
  apiBaseUrl?: string | null;
}

export async function sendPestPacSOAP(
  payload: EnterpriseSyncPayload,
  config: PestPacSoapConfig,
): Promise<void> {
  const base = (config.apiBaseUrl ?? PESTPAC_SOAP_DEFAULT_BASE).replace(/\/$/, "");

  const findingsXml = payload.InspectionFindings.map(
    (f) => `
      <pp:Finding>
        <pp:Code>${esc(f.Code)}</pp:Code>
        <pp:Description>${esc(f.Description)}</pp:Description>
        <pp:Severity>${esc(f.Severity)}</pp:Severity>
        ${f.CustomFields.WidthMm !== undefined ? `<pp:WidthMm>${f.CustomFields.WidthMm}</pp:WidthMm>` : ""}
        ${f.CustomFields.HeightMm !== undefined ? `<pp:HeightMm>${f.CustomFields.HeightMm}</pp:HeightMm>` : ""}
        ${f.CustomFields.VerifiedConfidence !== undefined ? `<pp:VerifiedConfidence>${f.CustomFields.VerifiedConfidence}</pp:VerifiedConfidence>` : ""}
        ${f.CustomFields.SurfaceType ? `<pp:SurfaceType>${esc(f.CustomFields.SurfaceType)}</pp:SurfaceType>` : ""}
        ${f.AttachmentUrl ? `<pp:AttachmentUrl>${esc(f.AttachmentUrl)}</pp:AttachmentUrl>` : ""}
      </pp:Finding>`,
  ).join("");

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:pp="http://tempuri.org/PestPacService">
  <soap:Body>
    <pp:SaveInspectionRecord>
      <pp:WorkOrderId>${esc(payload.ExternalWorkOrderId)}</pp:WorkOrderId>
      <pp:PropertyCode>${esc(payload.LocationReference.PropertyCode)}</pp:PropertyCode>
      <pp:EmployeeId>${esc(payload.ServiceDetails.CompletedByEmployeeId)}</pp:EmployeeId>
      <pp:TechnicianName>${esc(payload.ServiceDetails.TechnicianName)}</pp:TechnicianName>
      <pp:ServiceDate>${esc(payload.ServiceDetails.ServiceDate)}</pp:ServiceDate>
      <pp:TechnicianSigned>${payload.SignatureAudit.technicianSigned}</pp:TechnicianSigned>
      <pp:OwnerSigned>${payload.SignatureAudit.ownerSigned}</pp:OwnerSigned>
      <pp:OwnerNotAvailable>${payload.SignatureAudit.ownerNotAvailable}</pp:OwnerNotAvailable>
      ${payload.SignatureAudit.signedAt ? `<pp:SignedTimestamp>${esc(payload.SignatureAudit.signedAt)}</pp:SignedTimestamp>` : ""}
      <pp:Findings>${findingsXml}
      </pp:Findings>
    </pp:SaveInspectionRecord>
  </soap:Body>
</soap:Envelope>`;

  const res = await ssrfSafeFetch(`${base}/SaveInspectionRecord`, {
    method: "POST",
    redirect: "error", // never follow redirects — a redirect could point to a private host
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://tempuri.org/PestPacService/SaveInspectionRecord",
      "X-WorkWave-Key": config.apiKey,
    },
    body: envelope,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`PestPac SOAP failed (${res.status}): ${body}`);
  }
}

/** Minimal XML special-character escaping. */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
