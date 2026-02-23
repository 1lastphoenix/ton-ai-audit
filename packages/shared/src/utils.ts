import { createHash } from "node:crypto";
import path from "node:path";

import type { Language } from "./enums";

const languageByExtension: Record<string, Language> = {
  ".tolk": "tolk",
  ".fc": "func",
  ".func": "func",
  ".tact": "tact",
  ".fif": "fift",
  ".fift": "fift",
  ".tlb": "tl-b"
};

export function detectLanguageFromPath(filePath: string): Language {
  const extension = path.extname(filePath).toLowerCase();
  return languageByExtension[extension] ?? "unknown";
}

export function normalizePath(inputPath: string): string {
  return inputPath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function createContentFingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createFindingFingerprint(params: {
  title: string;
  filePath: string;
  startLine: number;
  endLine: number;
  severity: string;
}): string {
  const canonical = [
    params.title.toLowerCase().trim(),
    normalizePath(params.filePath).toLowerCase(),
    params.startLine,
    params.endLine,
    params.severity.toLowerCase().trim()
  ].join("::");

  return createHash("sha256").update(canonical).digest("hex");
}

export function safeRelativePath(baseDir: string, targetPath: string): string | null {
  const normalized = path.posix.normalize(targetPath.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    return null;
  }

  const resolved = path.posix.join(baseDir.replace(/\\/g, "/"), normalized);
  if (!resolved.startsWith(baseDir.replace(/\\/g, "/"))) {
    return null;
  }

  return normalized;
}