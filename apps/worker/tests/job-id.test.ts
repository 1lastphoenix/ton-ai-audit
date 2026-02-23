import { describe, expect, it } from "vitest";

import { toBullMqJobId } from "../src/job-id";

describe("toBullMqJobId", () => {
  it("replaces colon delimiters with BullMQ-safe delimiters", () => {
    expect(toBullMqJobId("verify:project-1:audit-1")).toBe("verify__project-1__audit-1");
  });

  it("keeps IDs without colons unchanged", () => {
    expect(toBullMqJobId("docs-index-123")).toBe("docs-index-123");
  });
});
