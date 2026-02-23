import { describe, expect, it } from "vitest";

import { computeFindingTransitions } from "../../src/processors/finding-lifecycle-core";

describe("computeFindingTransitions", () => {
  it("marks newly seen finding as opened", () => {
    const transitions = computeFindingTransitions({
      previousFindingIds: [],
      currentFindingIds: ["A"],
      previousStatusesByFindingId: {}
    });

    expect(transitions[0]).toMatchObject({ findingId: "A", transition: "opened" });
  });

  it("marks disappeared finding as resolved", () => {
    const transitions = computeFindingTransitions({
      previousFindingIds: ["A"],
      currentFindingIds: [],
      previousStatusesByFindingId: { A: "opened" }
    });

    expect(transitions[0]).toMatchObject({ findingId: "A", transition: "resolved" });
  });

  it("marks reopened finding as regressed", () => {
    const transitions = computeFindingTransitions({
      previousFindingIds: [],
      currentFindingIds: ["A"],
      previousStatusesByFindingId: { A: "resolved" }
    });

    expect(transitions[0]).toMatchObject({ findingId: "A", transition: "regressed" });
  });

  it("marks present in both as unchanged", () => {
    const transitions = computeFindingTransitions({
      previousFindingIds: ["A"],
      currentFindingIds: ["A"],
      previousStatusesByFindingId: { A: "opened" }
    });

    expect(transitions[0]).toMatchObject({ findingId: "A", transition: "unchanged" });
  });
});
