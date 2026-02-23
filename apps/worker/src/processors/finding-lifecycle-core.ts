import type { FindingTransition } from "@ton-audit/shared";

export type TransitionComputationInput = {
  previousFindingIds: string[];
  currentFindingIds: string[];
  previousStatusesByFindingId: Record<string, "opened" | "resolved">;
};

export type TransitionComputationResult = {
  findingId: string;
  transition: FindingTransition;
  currentStatus: "opened" | "resolved";
};

export function computeFindingTransitions(
  input: TransitionComputationInput
): TransitionComputationResult[] {
  const previousSet = new Set(input.previousFindingIds);
  const currentSet = new Set(input.currentFindingIds);
  const all = new Set([...previousSet, ...currentSet]);
  const transitions: TransitionComputationResult[] = [];

  for (const findingId of all) {
    const inPrevious = previousSet.has(findingId);
    const inCurrent = currentSet.has(findingId);

    let transition: FindingTransition = "unchanged";
    let currentStatus: "opened" | "resolved" = "opened";

    if (inCurrent && !inPrevious) {
      transition = input.previousStatusesByFindingId[findingId] === "resolved" ? "regressed" : "opened";
      currentStatus = "opened";
    } else if (!inCurrent && inPrevious) {
      transition = "resolved";
      currentStatus = "resolved";
    } else if (inCurrent && inPrevious) {
      transition = "unchanged";
      currentStatus = "opened";
    }

    transitions.push({
      findingId,
      transition,
      currentStatus
    });
  }

  return transitions;
}
