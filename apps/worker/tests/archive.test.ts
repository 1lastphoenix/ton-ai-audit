import { describe, expect, it } from "vitest";

import { validateArchiveEntries } from "../src/archive";

describe("validateArchiveEntries", () => {
  it("rejects zip-slip traversal", () => {
    expect(() =>
      validateArchiveEntries(
        [{ path: "../secrets.env", sizeBytes: 10 }],
        { maxFiles: 300, maxBytes: 1000 }
      )
    ).toThrow(/unsafe/i);
  });

  it("rejects file count overflow", () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      path: `f${index}.tact`,
      sizeBytes: 1
    }));

    expect(() =>
      validateArchiveEntries(entries, {
        maxFiles: 3,
        maxBytes: 100
      })
    ).toThrow(/too many files/i);
  });

  it("rejects decompressed-size overflow", () => {
    expect(() =>
      validateArchiveEntries(
        [
          { path: "a.fc", sizeBytes: 70 },
          { path: "b.fc", sizeBytes: 60 }
        ],
        {
          maxFiles: 20,
          maxBytes: 100
        }
      )
    ).toThrow(/decompressed size/i);
  });

  it("accepts valid entries", () => {
    const result = validateArchiveEntries(
      [
        { path: "contracts/main.tact", sizeBytes: 70 },
        { path: "tests/main.spec.ts", sizeBytes: 60 }
      ],
      {
        maxFiles: 20,
        maxBytes: 1000
      }
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.normalizedPath).toBe("contracts/main.tact");
  });
});
