import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);

const supportedExtensions = new Set([
  ".fc",
  ".fif",
  ".fift",
  ".func",
  ".js",
  ".md",
  ".tact",
  ".tlb",
  ".tolk",
  ".ts"
]);

function normalizeRelative(targetPath) {
  return targetPath.replace(/\\/g, "/");
}

export async function collectSourceFiles(rootDir = process.cwd()) {
  const queue = [rootDir];
  const files = [];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!supportedExtensions.has(extension)) {
        continue;
      }

      files.push(absolutePath);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

export async function readFileLines(absolutePath, rootDir = process.cwd()) {
  const content = await readFile(absolutePath, "utf8");
  const relativePath = normalizeRelative(path.relative(rootDir, absolutePath));
  return {
    filePath: relativePath,
    lines: content.split(/\r?\n/)
  };
}

export function clipSnippet(input, maxLength = 240) {
  const normalized = String(input ?? "").trim();
  if (normalized.length <= maxLength) {
    return normalized || "(empty line)";
  }

  return `${normalized.slice(0, maxLength)}...`;
}

export function countBySeverity(diagnostics) {
  return diagnostics.reduce(
    (acc, diagnostic) => {
      const severity = diagnostic.severity;
      acc[severity] = (acc[severity] ?? 0) + 1;
      return acc;
    },
    {
      critical: 0,
      high: 0,
      informational: 0,
      low: 0,
      medium: 0
    }
  );
}

export function writeScanPayload(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
