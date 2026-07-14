// ─── Shared workspace-inspection helpers ──────────────────────────────────────
// Executive capabilities read REAL files from the monorepo. These helpers locate
// the repo root (the server's cwd is the api-server package dir under pnpm) and
// walk the tree safely, skipping heavy/irrelevant directories.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export const DEFAULT_IGNORE = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".cache",
  ".local",
  ".turbo",
  ".expo",
  ".vite",
  ".next",
  ".pnpm",
]);

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".ico", ".avif"]);

let cachedRoot: string | null = null;

/** Locate the monorepo root by walking up to the pnpm-workspace.yaml. */
export function findRepoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

export function isCodeFile(p: string): boolean {
  return CODE_EXTS.has(path.extname(p).toLowerCase());
}

export function isImageFile(p: string): boolean {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

/** Recursively yield absolute file paths under `root`, skipping ignored + hidden dirs. */
export function* walkFiles(root: string, ignore: Set<string> = DEFAULT_IGNORE): Generator<string> {
  if (!existsSync(root)) return;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ignore.has(e.name) || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
  }
}

export function readTextSafe(p: string): string | null {
  try {
    if (statSync(p).size > 2_000_000) return null; // skip very large files
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

export function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}

export function fileMtime(p: string): Date | null {
  try {
    return statSync(p).mtime;
  } catch {
    return null;
  }
}
