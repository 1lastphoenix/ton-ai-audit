import { describe, expect, it } from "vitest";

import {
  createFindingFingerprint,
  safeRelativePath,
  uploadInitSchema,
  workingCopyPatchFileSchema
} from "@ton-audit/shared";

describe("shared utils", () => {
  it("keeps finding fingerprint stable", () => {
    const one = createFindingFingerprint({
      title: "Unchecked bounce handling",
      filePath: "contracts/wallet.tact",
      startLine: 12,
      endLine: 19,
      severity: "high"
    });

    const two = createFindingFingerprint({
      title: " Unchecked bounce handling ",
      filePath: "contracts\\wallet.tact",
      startLine: 12,
      endLine: 19,
      severity: "HIGH"
    });

    expect(one).toBe(two);
  });

  it("rejects path traversal in safeRelativePath", () => {
    expect(safeRelativePath("root", "../secrets.txt")).toBeNull();
    expect(safeRelativePath("root", "contracts/main.tact")).toBe("contracts/main.tact");
  });

  it("validates upload payload boundaries", () => {
    const parsed = uploadInitSchema.safeParse({
      filename: "bundle.zip",
      contentType: "application/zip",
      sizeBytes: 1024,
      type: "zip",
      parts: 1
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid working copy patch payload", () => {
    const parsed = workingCopyPatchFileSchema.safeParse({
      path: "",
      content: "body"
    });

    expect(parsed.success).toBe(false);
  });
});
