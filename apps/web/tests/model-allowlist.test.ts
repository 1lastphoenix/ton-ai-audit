import { describe, expect, it } from "vitest";

import { assertAllowedModel } from "../lib/server/model-allowlist-core";

describe("assertAllowedModel", () => {
  it("accepts allowlisted model", () => {
    expect(() =>
      assertAllowedModel("google/gemini-2.5-flash", [
        "google/gemini-2.5-flash",
        "google/gemini-2.5-flash",
      ]),
    ).not.toThrow();
  });

  it("rejects model outside allowlist", () => {
    expect(() =>
      assertAllowedModel("anthropic/claude-sonnet-4", [
        "google/gemini-2.5-flash",
        "google/gemini-2.5-flash",
      ]),
    ).toThrow(/allowlist/i);
  });
});
