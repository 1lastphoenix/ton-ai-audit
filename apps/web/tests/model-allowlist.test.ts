import { describe, expect, it } from "vitest";

import { assertAllowedModel } from "../lib/server/model-allowlist-core";

describe("assertAllowedModel", () => {
  it("accepts allowlisted model", () => {
    expect(() =>
      assertAllowedModel("openai/gpt-5", ["openai/gpt-5", "openai/gpt-5-mini"])
    ).not.toThrow();
  });

  it("rejects model outside allowlist", () => {
    expect(() =>
      assertAllowedModel("anthropic/claude-sonnet-4", ["openai/gpt-5", "openai/gpt-5-mini"])
    ).toThrow(/allowlist/i);
  });
});
