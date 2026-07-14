// ─── CTO capability: codebase & architecture inspection ───────────────────────
import path from "path";
import type { ExecutiveReport } from "./index.js";
import {
  findRepoRoot,
  walkFiles,
  isCodeFile,
  readTextSafe,
  countLines,
  listDirs,
  listFiles,
} from "./repo.js";

export async function inspectCodebase(): Promise<ExecutiveReport> {
  const root = findRepoRoot();

  let totalFiles = 0;
  let codeFiles = 0;
  let loc = 0;
  let todos = 0;
  const largeFiles: { rel: string; lines: number }[] = [];

  for (const file of walkFiles(root)) {
    totalFiles++;
    if (!isCodeFile(file)) continue;
    codeFiles++;
    const content = readTextSafe(file);
    if (content === null) continue;
    const lines = countLines(content);
    loc += lines;
    if (lines > 600) largeFiles.push({ rel: path.relative(root, file), lines });
    const todoMatches = content.match(/\b(TODO|FIXME)\b/g);
    if (todoMatches) todos += todoMatches.length;
  }

  const artifacts = listDirs(path.join(root, "artifacts"));
  const libs = listDirs(path.join(root, "lib"));

  const schema = readTextSafe(path.join(root, "lib/db/src/schema/index.ts")) ?? "";
  const dbTables = (schema.match(/pgTable\(/g) ?? []).length;

  const routeFiles = listFiles(path.join(root, "artifacts/api-server/src/routes")).filter((f) =>
    f.endsWith(".ts"),
  ).length;

  const rootPkg = readTextSafe(path.join(root, "package.json"));
  const apiPkg = readTextSafe(path.join(root, "artifacts/api-server/package.json"));
  const deps = new Set<string>();
  for (const raw of [rootPkg, apiPkg]) {
    if (!raw) continue;
    try {
      const pkg = JSON.parse(raw);
      for (const k of Object.keys(pkg.dependencies ?? {})) deps.add(k);
      for (const k of Object.keys(pkg.devDependencies ?? {})) deps.add(k);
    } catch {
      /* ignore malformed package.json */
    }
  }

  largeFiles.sort((a, b) => b.lines - a.lines);

  const findings: ExecutiveReport["findings"] = [];
  if (largeFiles.length > 0) {
    findings.push({
      severity: largeFiles.length > 5 ? "warning" : "info",
      text: `${largeFiles.length} file(s) over 600 lines — largest: ${largeFiles[0].rel} (${largeFiles[0].lines} lines). Consider splitting.`,
    });
  }
  if (todos > 0) {
    findings.push({
      severity: todos > 25 ? "warning" : "info",
      text: `${todos} TODO/FIXME marker(s) across the codebase.`,
    });
  }
  findings.push({
    severity: "info",
    text: `Architecture: ${artifacts.length} artifacts (${artifacts.join(", ")}) and ${libs.length} shared libs.`,
  });

  const status: ExecutiveReport["status"] =
    largeFiles.length > 8 || todos > 50 ? "attention" : "healthy";

  return {
    status,
    headline: `${codeFiles.toLocaleString()} source files, ${loc.toLocaleString()} lines across ${artifacts.length} artifacts`,
    summary:
      `The codebase spans ${totalFiles.toLocaleString()} tracked files (${codeFiles.toLocaleString()} source, ${loc.toLocaleString()} LOC) ` +
      `organized into ${artifacts.length} artifacts and ${libs.length} shared libraries. ` +
      `The data layer defines ${dbTables} database tables and the API exposes ${routeFiles} route modules. ` +
      `${deps.size} dependencies are in use.`,
    metrics: [
      { label: "Source files", value: codeFiles.toLocaleString() },
      { label: "Lines of code", value: loc.toLocaleString() },
      { label: "Artifacts", value: String(artifacts.length) },
      { label: "DB tables", value: String(dbTables) },
      { label: "API routes", value: String(routeFiles) },
      { label: "Dependencies", value: String(deps.size) },
    ],
    findings,
  };
}
