import { detectLanguageFromPath, normalizePath } from "@ton-audit/shared";

import type { SandboxFile, SandboxPlan, SandboxStep } from "./types";

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;

function createStep(
  name: string,
  command: string,
  args: string[],
  optional = false,
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS
): SandboxStep {
  return {
    name,
    command,
    args,
    optional,
    timeoutMs
  };
}

function looksLikeBlueprint(files: SandboxFile[]) {
  const fileNames = new Set(files.map((file) => normalizePath(file.path).toLowerCase()));
  if (fileNames.has("blueprint.config.ts") || fileNames.has("blueprint.config.js")) {
    return true;
  }

  const packageJson = files.find((file) => normalizePath(file.path).toLowerCase() === "package.json");
  if (!packageJson) {
    return false;
  }

  try {
    const parsed = JSON.parse(packageJson.content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    const allDeps = {
      ...parsed.dependencies,
      ...parsed.devDependencies
    };

    if (Object.keys(allDeps).some((dependency) => dependency.includes("blueprint"))) {
      return true;
    }

    return Object.values(parsed.scripts ?? {}).some((script) => script.includes("blueprint"));
  } catch {
    return false;
  }
}

function languageSet(files: SandboxFile[]) {
  const languages = new Set<string>();
  for (const file of files) {
    const language = detectLanguageFromPath(file.path);
    if (language !== "unknown") {
      languages.add(language);
    }
  }
  return [...languages];
}

function blueprintPlan(languages: string[]): SandboxPlan {
  return {
    adapter: "blueprint",
    languages,
    reason: "Detected Blueprint project files.",
    steps: [
      createStep("blueprint-install", "npm", ["install", "--ignore-scripts"], true),
      createStep("blueprint-build", "npx", ["blueprint", "build"], false),
      createStep("blueprint-test", "npx", ["blueprint", "test"], true)
    ]
  };
}

function singleLanguagePlan(language: string): SandboxPlan {
  switch (language) {
    case "tact":
      return {
        adapter: "tact",
        languages: [language],
        reason: "Detected Tact contract files.",
        steps: [createStep("tact-compile", "npx", ["blueprint", "build"], true)]
      };
    case "func":
      return {
        adapter: "func",
        languages: [language],
        reason: "Detected FunC contract files.",
        steps: [
          createStep("func-toolchain-check", "func", ["-v"], true),
          createStep("func-blueprint-build", "npx", ["blueprint", "build"], true)
        ]
      };
    case "tolk":
      return {
        adapter: "tolk",
        languages: [language],
        reason: "Detected Tolk contract files.",
        steps: [
          createStep("tolk-toolchain-check", "tolk", ["--help"], true),
          createStep("tolk-blueprint-build", "npx", ["blueprint", "build"], true)
        ]
      };
    default:
      return {
        adapter: "none",
        languages: [language],
        reason: "Language not supported by sandbox adapter.",
        steps: []
      };
  }
}

function mixedPlan(languages: string[]): SandboxPlan {
  const steps: SandboxStep[] = [];
  if (languages.includes("tact")) {
    steps.push(createStep("mixed-tact-build", "npx", ["blueprint", "build"], true));
  }
  if (languages.includes("func")) {
    steps.push(createStep("mixed-func-check", "func", ["-v"], true));
  }
  if (languages.includes("tolk")) {
    steps.push(createStep("mixed-tolk-check", "tolk", ["--help"], true));
  }

  return {
    adapter: "mixed",
    languages,
    reason: "Detected mixed TON language set without Blueprint metadata.",
    steps
  };
}

export function planSandboxVerification(files: SandboxFile[]): SandboxPlan {
  const normalized = files.map((file) => ({
    path: normalizePath(file.path),
    content: file.content
  }));

  const languages = languageSet(normalized);
  if (!languages.length) {
    return {
      adapter: "none",
      languages: [],
      reason: "No supported TON contract files were detected.",
      steps: []
    };
  }

  if (looksLikeBlueprint(normalized)) {
    return blueprintPlan(languages);
  }

  if (languages.length === 1) {
    return singleLanguagePlan(languages[0]!);
  }

  return mixedPlan(languages);
}
