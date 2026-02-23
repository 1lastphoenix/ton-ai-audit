import { describe, expect, it } from "vitest";

import { buildFileTree } from "../lib/server/file-tree";

describe("buildFileTree", () => {
  it("builds nested sorted tree", () => {
    const tree = buildFileTree([
      "contracts/Wallet.tact",
      "contracts/lib/math.fc",
      "tests/wallet.spec.ts",
      "README.md"
    ]);

    expect(tree.map((item) => item.path)).toEqual(["contracts", "tests", "README.md"]);

    const contracts = tree[0];
    expect(contracts?.type).toBe("directory");
    expect(contracts?.children?.map((item) => item.path)).toEqual([
      "contracts/lib",
      "contracts/Wallet.tact"
    ]);
  });

  it("normalizes windows-style paths", () => {
    const tree = buildFileTree(["contracts\\Wallet.tact"]);
    expect(tree[0]?.path).toBe("contracts");
    expect(tree[0]?.children?.[0]?.path).toBe("contracts/Wallet.tact");
  });
});
