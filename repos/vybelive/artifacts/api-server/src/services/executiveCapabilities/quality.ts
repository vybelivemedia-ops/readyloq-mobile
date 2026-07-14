// ─── QA Director capability: test inventory + log/regression scan ─────────────
import path from "path";
import { existsSync, readdirSync } from "fs";
import type { ExecutiveReport } from "./index.js";
import { findRepoRoot, walkFiles, readTextSafe, isCodeFile } from "./repo.js";

const LOG_DIR = "/tmp/logs";

export async function inspectQuality(): Promise<ExecutiveReport> {
  const root = findRepoRoot();

  let testFiles = 0;
  let skipped = 0;
  let only = 0;
  let sourceFiles = 0;

  for (const file of walkFiles(root)) {
    if (!isCodeFile(file)) continue;
    sourceFiles++;
    const base = path.basename(file);
    if (base.endsWith(".test.ts") || base.endsWith(".spec.ts") || base.endsWith(".test.tsx")) {
      testFiles++;
      const content = readTextSafe(file) ?? "";
      skipped += (content.match(/\.(skip|todo)\s*\(/g) ?? []).length;
      only += (content.match(/\.only\s*\(/g) ?? []).length;
    }
  }

  // Scan recently captured workflow logs for error/warning signals.
  let errorLines = 0;
  let warnLines = 0;
  let logsScanned = 0;
  const recentErrors: string[] = [];
  if (existsSync(LOG_DIR)) {
    let logFiles: string[] = [];
    try {
      logFiles = readdirSync(LOG_DIR)
        .filter((f) => f.endsWith(".log"))
        .sort()
        .slice(-10);
    } catch {
      /* ignore */
    }
    for (const f of logFiles) {
      const content = readTextSafe(path.join(LOG_DIR, f));
      if (content === null) continue;
      logsScanned++;
      for (const line of content.split("\n")) {
        if (/\b(ERROR|FATAL)\b/i.test(line) || /\berror\b.*\b(stack|exception)\b/i.test(line)) {
          errorLines++;
          if (recentErrors.length < 5) recentErrors.push(line.trim().slice(0, 160));
        } else if (/\bWARN(ING)?\b/i.test(line)) {
          warnLines++;
        }
      }
    }
  }

  const findings: ExecutiveReport["findings"] = [];
  if (errorLines > 0) {
    findings.push({
      severity: "critical",
      text: `${errorLines} error line(s) in recent logs. Sample: ${recentErrors[0] ?? "(n/a)"}`,
    });
  }
  if (warnLines > 0) {
    findings.push({ severity: "warning", text: `${warnLines} warning line(s) in recent logs.` });
  }
  if (testFiles < 5) {
    findings.push({
      severity: "warning",
      text: `Only ${testFiles} automated test file(s) for ${sourceFiles} source files — coverage is thin.`,
    });
  }
  if (only > 0) {
    findings.push({
      severity: "warning",
      text: `${only} focused test(s) (.only) found — these suppress the rest of the suite.`,
    });
  }
  if (skipped > 0) {
    findings.push({ severity: "info", text: `${skipped} skipped/todo test(s).` });
  }
  if (logsScanned === 0) {
    findings.push({
      severity: "info",
      text: "No captured workflow logs to scan yet — refresh logs to enable regression detection.",
    });
  }
  if (findings.length === 0) {
    findings.push({ severity: "info", text: "No regressions or test smells detected." });
  }

  const status: ExecutiveReport["status"] =
    errorLines > 0 ? "critical" : warnLines > 0 || testFiles < 5 || only > 0 ? "attention" : "healthy";

  return {
    status,
    headline:
      errorLines > 0
        ? `${errorLines} error(s) in recent logs — needs attention`
        : `${testFiles} test file(s), ${errorLines} recent errors`,
    summary:
      `Found ${testFiles} automated test file(s) across ${sourceFiles} source files. ` +
      `Scanned ${logsScanned} recent log file(s): ${errorLines} error line(s) and ${warnLines} warning line(s). ` +
      `Test smells: ${only} focused, ${skipped} skipped.`,
    metrics: [
      { label: "Test files", value: String(testFiles) },
      { label: "Log errors", value: String(errorLines) },
      { label: "Log warnings", value: String(warnLines) },
      { label: "Focused tests", value: String(only) },
      { label: "Skipped tests", value: String(skipped) },
      { label: "Logs scanned", value: String(logsScanned) },
    ],
    findings,
  };
}
