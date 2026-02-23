import { describe, expect, it } from "vitest";

import { canReadJobEvents } from "../lib/server/job-events-auth";

describe("canReadJobEvents", () => {
  it("allows when event project matches requested project", () => {
    expect(
      canReadJobEvents({
        requestedProjectId: "3d5d5ec0-76f8-4d0f-9731-34c0ee3f31f2",
        eventProjectId: "3d5d5ec0-76f8-4d0f-9731-34c0ee3f31f2"
      })
    ).toBe(true);
  });

  it("rejects when project ids do not match", () => {
    expect(
      canReadJobEvents({
        requestedProjectId: "3d5d5ec0-76f8-4d0f-9731-34c0ee3f31f2",
        eventProjectId: "7f8f4d0f-9731-34c0ee3f31f2-3d5d5ec076"
      })
    ).toBe(false);
  });

  it("rejects if event has no project scope", () => {
    expect(
      canReadJobEvents({
        requestedProjectId: "3d5d5ec0-76f8-4d0f-9731-34c0ee3f31f2",
        eventProjectId: null
      })
    ).toBe(false);
  });
});
