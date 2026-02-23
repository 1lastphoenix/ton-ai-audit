import { describe, it } from "vitest";

describe.skip("e2e workflow", () => {
  it("github login -> upload -> audit -> edit -> re-audit -> pdf export", async () => {
    // Requires running web+worker+infra services and OAuth credentials.
    // Intentionally skipped in CI/local unit runs.
  });
});
