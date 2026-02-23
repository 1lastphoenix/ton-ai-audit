export type SandboxFile = {
  path: string;
  content: string;
};

export type SandboxStep = {
  name: string;
  command: string;
  args: string[];
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
  steps: SandboxStep[];
};

export type SandboxStepResult = {
  name: string;
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
