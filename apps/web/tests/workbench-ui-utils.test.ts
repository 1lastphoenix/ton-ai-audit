import { describe, expect, it } from "vitest";

import {
  filterWorkbenchTree,
  resolveMonacoTheme
} from "../components/workbench/workbench-ui-utils";

describe("workbench ui utils", () => {
  it("filters explorer tree by file name and preserves parent directories", () => {
    const tree = [
      {
        name: "contracts",
        path: "contracts",
        type: "directory" as const,
        children: [
          {
            name: "counter.tolk",
            path: "contracts/counter.tolk",
            type: "file" as const
          },
          {
            name: "wallet.tolk",
            path: "contracts/wallet.tolk",
            type: "file" as const
          }
        ]
      },
      {
        name: "README.md",
        path: "README.md",
        type: "file" as const
      }
    ];

    const filtered = filterWorkbenchTree(tree, "counter");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.path).toBe("contracts");
    expect(filtered[0]?.children).toHaveLength(1);
    expect(filtered[0]?.children?.[0]?.path).toBe("contracts/counter.tolk");
  });

  it("returns the full tree for an empty query", () => {
    const tree = [
      {
        name: "contracts",
        path: "contracts",
        type: "directory" as const,
        children: []
      }
    ];

    expect(filterWorkbenchTree(tree, "  ")).toEqual(tree);
  });

  it("resolves Monaco theme from app theme state", () => {
    expect(resolveMonacoTheme({ resolvedTheme: "dark", prefersDark: false })).toBe("vs-dark");
    expect(resolveMonacoTheme({ resolvedTheme: "light", prefersDark: true })).toBe("vs");
    expect(resolveMonacoTheme({ resolvedTheme: "system", prefersDark: true })).toBe("vs-dark");
    expect(resolveMonacoTheme({ resolvedTheme: "system", prefersDark: false })).toBe("vs");
    expect(resolveMonacoTheme({ resolvedTheme: undefined, prefersDark: true })).toBe("vs-dark");
  });
});
