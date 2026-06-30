import type { BrandingProfile, BrandingProfileInput } from "@workspace/api-client-react";
import { DEFAULT_BRANDING } from "@/lib/branding";

/** A fully-string-backed working copy of an editable branding profile. */
export interface BrandingDraft {
  name: string;
  companyName: string;
  tagline: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  licenseNumber: string;
  logoUrl: string;
  appIconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  reportFooterText: string;
  supportInfo: string;
  signatureDisclaimer: string;
  emailSenderName: string;
  emailReplyTo: string;
  emailFooter: string;
  poweredByVisible: boolean;
}

const NULLABLE_FIELDS: (keyof BrandingDraft)[] = [
  "tagline",
  "companyAddress",
  "companyPhone",
  "companyEmail",
  "companyWebsite",
  "licenseNumber",
  "logoUrl",
  "appIconUrl",
  "primaryColor",
  "secondaryColor",
  "accentColor",
  "reportFooterText",
  "supportInfo",
  "signatureDisclaimer",
  "emailSenderName",
  "emailReplyTo",
  "emailFooter",
];

export function profileToDraft(p: BrandingProfile): BrandingDraft {
  return {
    name: p.name ?? "",
    companyName: p.companyName ?? "",
    tagline: p.tagline ?? "",
    companyAddress: p.companyAddress ?? "",
    companyPhone: p.companyPhone ?? "",
    companyEmail: p.companyEmail ?? "",
    companyWebsite: p.companyWebsite ?? "",
    licenseNumber: p.licenseNumber ?? "",
    logoUrl: p.logoUrl ?? "",
    appIconUrl: p.appIconUrl ?? "",
    primaryColor: p.primaryColor ?? "#0ea5e9",
    secondaryColor: p.secondaryColor ?? "#1e293b",
    accentColor: p.accentColor ?? "#06b6d4",
    reportFooterText: p.reportFooterText ?? "",
    supportInfo: p.supportInfo ?? "",
    signatureDisclaimer: p.signatureDisclaimer ?? "",
    emailSenderName: p.emailSenderName ?? "",
    emailReplyTo: p.emailReplyTo ?? "",
    emailFooter: p.emailFooter ?? "",
    poweredByVisible: p.poweredByVisible ?? true,
  };
}

/** Convert a draft to an API input payload (empty strings on nullable fields → null). */
export function draftToInput(d: BrandingDraft): BrandingProfileInput {
  const out: Record<string, unknown> = {
    name: d.name.trim() || "Untitled Profile",
    companyName: d.companyName.trim() || "Company",
    poweredByVisible: d.poweredByVisible,
  };
  for (const key of NULLABLE_FIELDS) {
    const v = (d[key] as string).trim();
    out[key] = v === "" ? null : v;
  }
  return out as BrandingProfileInput;
}

/** Build a full BrandingProfile (for live preview / applying to the document). */
export function draftToProfile(d: BrandingDraft, base?: BrandingProfile): BrandingProfile {
  const input = draftToInput(d);
  return {
    ...(base ?? DEFAULT_BRANDING),
    ...input,
  } as BrandingProfile;
}

/** Stable JSON for dirty-checking a draft. */
export function draftKey(d: BrandingDraft): string {
  return JSON.stringify(d);
}

const EXPORT_FIELDS: (keyof BrandingDraft)[] = [
  "name",
  "companyName",
  ...NULLABLE_FIELDS,
  "poweredByVisible",
];

/** Serialize a profile to a portable JSON object (no ids / timestamps). */
export function profileToExport(p: BrandingProfile): Record<string, unknown> {
  const d = profileToDraft(p);
  const out: Record<string, unknown> = { _type: "readyloq.branding-profile", version: 1 };
  for (const key of EXPORT_FIELDS) out[key] = d[key];
  return out;
}

/** Parse imported JSON into an API input payload, ignoring unknown keys. */
export function importToInput(raw: unknown): BrandingProfileInput {
  if (!raw || typeof raw !== "object") throw new Error("Invalid profile file");
  const obj = raw as Record<string, unknown>;
  const base = profileToDraft(DEFAULT_BRANDING);
  const draft: BrandingDraft = { ...base };
  for (const key of EXPORT_FIELDS) {
    if (key === "poweredByVisible") {
      if (typeof obj[key] === "boolean") draft.poweredByVisible = obj[key] as boolean;
    } else if (typeof obj[key] === "string") {
      (draft[key] as string) = obj[key] as string;
    }
  }
  if (!draft.companyName.trim() && !draft.name.trim()) {
    throw new Error("File is missing company / profile name");
  }
  if (!draft.name.trim()) draft.name = draft.companyName;
  return draftToInput(draft);
}
