import type { SandboxStepResult } from "./types";

export function summarizeSandboxResults(results: SandboxStepResult[]) {
  const completed = results.filter((result) => result.status === "completed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const timeout = results.filter((result) => result.status === "timeout").length;

  return {
    completed,
    failed,
    skipped,
    timeout
  };
}
