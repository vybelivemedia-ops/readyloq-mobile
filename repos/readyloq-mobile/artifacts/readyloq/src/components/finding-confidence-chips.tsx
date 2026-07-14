import type { ReactNode } from "react";
import { Camera, BadgeCheck, Clock, AlertCircle } from "lucide-react";
import {
  deriveEvidenceQuality,
  deriveVerificationStatus,
  EVIDENCE_QUALITY_LABEL,
  VERIFICATION_LABEL,
  evidenceQualityClasses,
  verificationClasses,
  type VerificationStatus,
} from "@/lib/finding-confidence";

interface FindingLike {
  confidence?: number | null;
  evidenceQuality?: string | null;
  imageUrl?: string | null;
}

function Chip({ cls, children }: { cls: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function ConfidenceChip({ value }: { value: number }) {
  const pct = Math.round((value ?? 0) * 100);
  const cls =
    pct >= 80
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : pct >= 60
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-red-500/15 text-red-400 border-red-500/30";
  const label = pct >= 80 ? "High" : pct >= 60 ? "Medium" : "Low";
  return <Chip cls={cls}>Confidence {pct}% · {label}</Chip>;
}

export function EvidenceQualityChip({ finding }: { finding: FindingLike }) {
  const q = deriveEvidenceQuality(finding);
  return (
    <Chip cls={evidenceQualityClasses[q]}>
      <Camera className="h-3 w-3" /> Evidence: {EVIDENCE_QUALITY_LABEL[q]}
    </Chip>
  );
}

export function VerificationChip({ status }: { status: VerificationStatus }) {
  const Icon = status === "verified" ? BadgeCheck : status === "disputed" ? AlertCircle : Clock;
  return (
    <Chip cls={verificationClasses[status]}>
      <Icon className="h-3 w-3" /> {VERIFICATION_LABEL[status]}
    </Chip>
  );
}

/** Full Report Confidence model row: Confidence + Evidence Quality + Verification status. */
export function FindingConfidenceRow({
  finding,
  feedbackStatus,
  reportStatus,
}: {
  finding: FindingLike;
  feedbackStatus?: string | null;
  reportStatus?: string | null;
}) {
  const vs = deriveVerificationStatus({ feedbackStatus, reportStatus });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ConfidenceChip value={finding.confidence ?? 0} />
      <EvidenceQualityChip finding={finding} />
      <VerificationChip status={vs} />
    </div>
  );
}
