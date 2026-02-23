import { describe, expect, it } from "vitest";

import { normalizeDocsSourceUrl, toIndexableText } from "../../src/processors/docs-sources";

describe("docs source normalization", () => {
  it("maps github blob URLs to raw URLs", () => {
    expect(
      normalizeDocsSourceUrl("https://github.com/ton-org/create-ton/blob/main/README.md")
    ).toBe("https://raw.githubusercontent.com/ton-org/create-ton/main/README.md");
  });

  it("keeps docs.ton.org URL unchanged", () => {
    expect(normalizeDocsSourceUrl("https://docs.ton.org/languages/tolk/overview")).toBe(
      "https://docs.ton.org/languages/tolk/overview"
    );
  });
});

describe("toIndexableText", () => {
  it("strips markdown markup for github raw docs", () => {
    const text = toIndexableText({
      sourceType: "github",
      body: "# Title\n\nSome **bold** text and `code`."
    });

    expect(text).toContain("Title");
    expect(text).toContain("Some bold text and code");
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
  });
});
