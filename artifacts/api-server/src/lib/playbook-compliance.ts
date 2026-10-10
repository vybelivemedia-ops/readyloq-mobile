/**
 * Learning Engine — evaluates inspection findings against the company's active
 * playbooks and returns a list of compliance violations.
 *
 * Matching logic:
 *  • A playbook is "in scope" when any finding's category or species matches
 *    one of the playbook's targetPests (case-insensitive substring).
 *  • For each required step, we check whether any finding's `treatment` text
 *    contains the step label (case-insensitive). If none does, it's a
 *    violation.
 *  • Chemical restrictions are checked against the treatment_logs product
 *    names passed in separately (so the caller resolves them from the DB).
 */

import type { CompanyPlaybook } from "@workspace/db";
import type { Finding } from "@workspace/db";

export interface ComplianceViolation {
  playbookId: number;
  playbookTitle: string;
  type: "missing_step" | "restricted_chemical";
  missingStep?: string;
  restrictedChemical?: string;
  severity: "WARNING" | "ERROR";
  message: string;
}

export interface ComplianceResult {
  compliant: boolean;
  violations: ComplianceViolation[];
}

/**
 * @param findings      AI + technician findings for the inspection.
 * @param productNames  Chemical product names used in treatment logs.
 * @param playbooks     Active playbooks for the company.
 */
export function evaluatePlaybookCompliance(
  findings: Finding[],
  productNames: string[],
  playbooks: CompanyPlaybook[],
): ComplianceResult {
  const violations: ComplianceViolation[] = [];

  for (const playbook of playbooks) {
    // Is this playbook in scope for the pests found?
    const inScope = findings.some((f) =>
      playbook.targetPests.some(
        (target) =>
          f.category?.toLowerCase().includes(target.toLowerCase()) ||
          (f.species && f.species.toLowerCase().includes(target.toLowerCase())),
      ),
    );

    if (!inScope) continue;

    // Check required steps — each must appear in at least one finding's treatment text.
    for (const step of playbook.requiredSteps) {
      const covered = findings.some(
        (f) =>
          f.treatment &&
          f.treatment.toLowerCase().includes(step.label.toLowerCase()),
      );
      if (!covered) {
        violations.push({
          playbookId: playbook.id,
          playbookTitle: playbook.title,
          type: "missing_step",
          missingStep: step.label,
          severity: "WARNING",
          message: `"${step.label}" was not logged for this treatment — required by "${playbook.title}".`,
        });
      }
    }

    // Check chemical restrictions — flag any product name that matches.
    for (const restriction of playbook.chemicalRestrictions) {
      const used = productNames.some((p) =>
        p.toLowerCase().includes(restriction.name.toLowerCase()),
      );
      if (used) {
        violations.push({
          playbookId: playbook.id,
          playbookTitle: playbook.title,
          type: "restricted_chemical",
          restrictedChemical: restriction.name,
          severity: "ERROR",
          message: `Restricted chemical "${restriction.name}" was used — prohibited by "${playbook.title}".${restriction.reason ? ` Reason: ${restriction.reason}` : ""}`,
        });
      }
    }
  }

  return { compliant: violations.length === 0, violations };
}
