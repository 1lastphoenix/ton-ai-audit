export type SandboxFile = {
  path: string;
  content: string;
};

export type SandboxStepAction =
  | "bootstrap-create-ton"
  | "blueprint-build"
  | "blueprint-test"
  | "tact-check"
  | "func-check"
  | "tolk-check";

export type SandboxStep = {
  id: string;
  action: SandboxStepAction;
  timeoutMs: number;
  optional?: boolean;
};

export type SandboxAdapter =
  | "blueprint"
  | "tact"
  | "func"
  | "tolk"
  | "mixed"
  | "none";

export type SandboxPlan = {
  adapter: SandboxAdapter;
  languages: string[];
  reason: string;
  bootstrapMode: "none" | "create-ton";
  seedTemplate: "tact-empty" | "tolk-empty" | "func-empty" | null;
  unsupportedReasons: string[];
  steps: SandboxStep[];
};

export type SandboxStepResult = {
  id: string;
  action: SandboxStepAction;
  command: string;
  args: string[];
  status: "completed" | "failed" | "skipped" | "timeout";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type SandboxExecutionResponse = {
  workspaceId: string;
  mode: "local" | "docker";
  results: SandboxStepResult[];
};
