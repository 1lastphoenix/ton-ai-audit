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

export type SandboxProgressStep = {
  id: string;
  action: SandboxStepAction;
  optional: boolean;
  timeoutMs: number;
  status: "running" | "completed" | "failed" | "skipped" | "timeout";
  command?: string;
  args?: string[];
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
};

export type SandboxExecutionProgressEvent =
  | {
      type: "started";
      workspaceId: string;
      mode: "local" | "docker";
      totalSteps: number;
      steps: Array<Pick<SandboxProgressStep, "id" | "action" | "optional" | "timeoutMs">>;
    }
  | {
      type: "step-started";
      index: number;
      totalSteps: number;
      step: SandboxProgressStep;
    }
  | {
      type: "step-finished";
      index: number;
      totalSteps: number;
      step: SandboxProgressStep;
    }
  | {
      type: "completed";
      workspaceId: string;
      mode: "local" | "docker";
      totalSteps: number;
      results: SandboxStepResult[];
    }
  | {
      type: "error";
      message: string;
    };
