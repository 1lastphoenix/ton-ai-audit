import path from "node:path";

import {
  acceptedUploadExtensions,
  detectLanguageFromPath,
  normalizePath
} from "@ton-audit/shared";

type ArchiveEntryInput = {
  path: string;
  sizeBytes: number;
};

type ArchiveLimits = {
  maxFiles: number;
  maxBytes: number;
};

export type ValidatedArchiveEntry = {
  normalizedPath: string;
  sizeBytes: number;
  isTestFile: boolean;
  language: ReturnType<typeof detectLanguageFromPath>;
};

function isAllowedFile(pathname: string) {
  const extension = path.extname(pathname).toLowerCase();
  return acceptedUploadExtensions.includes(extension as (typeof acceptedUploadExtensions)[number]);
}

function isUnsafePath(pathname: string) {
  if (!pathname || pathname.includes("\0")) {
    return true;
  }

  const normalized = normalizePath(pathname);
  if (!normalized) {
    return true;
  }

  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return true;
  }

  const segments = normalized.split("/");
  return segments.some((segment) => segment === "..");
}

export function validateArchiveEntries(
  entries: ArchiveEntryInput[],
  limits: ArchiveLimits
): ValidatedArchiveEntry[] {
  if (entries.length > limits.maxFiles) {
    throw new Error(`Too many files in archive. Max ${limits.maxFiles}.`);
  }

  let totalSize = 0;
  const validated: ValidatedArchiveEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.sizeBytes < 0) {
      throw new Error(`Invalid file size for ${entry.path}`);
    }

    if (isUnsafePath(entry.path)) {
      throw new Error(`Unsafe archive path detected: ${entry.path}`);
    }

    const normalizedPath = normalizePath(entry.path);
    if (!isAllowedFile(normalizedPath)) {
      continue;
    }

    if (seen.has(normalizedPath)) {
      continue;
    }

    totalSize += entry.sizeBytes;
    if (totalSize > limits.maxBytes) {
      throw new Error(`Decompressed size exceeds ${limits.maxBytes} bytes`);
    }

    seen.add(normalizedPath);
    validated.push({
      normalizedPath,
      sizeBytes: entry.sizeBytes,
      isTestFile: /(^|\/)(test|tests|__tests__)\/|\.spec\./i.test(normalizedPath),
      language: detectLanguageFromPath(normalizedPath)
    });
  }

  return validated;
}
