import {
  detectLanguageFromPath,
  normalizePath,
  type AuditProfile
} from "@ton-audit/shared";

import type {
  SandboxFile,
  SandboxPlan,
  SandboxStep,
  SandboxStepAction
} from "./types";

const DEFAULT_BUILD_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_SECURITY_TIMEOUT_MS = 2 * 60 * 1000;
const OPTIONAL_BLUEPRINT_TIMEOUT_MS = 90 * 1000;

function createStep(
  id: string,
  action: SandboxStepAction,
  optional = false,
  timeoutMs?: number
): SandboxStep {
  const resolvedTimeoutMs =
    timeoutMs ??
    (() => {
      if (action === "bootstrap-create-ton") {
        return DEFAULT_BOOTSTRAP_TIMEOUT_MS;
      }
      if (action === "security-rules-scan" || action === "security-surface-scan") {
        return DEFAULT_SECURITY_TIMEOUT_MS;
      }
      if (optional && (action === "blueprint-build" || action === "blueprint-test")) {
        return OPTIONAL_BLUEPRINT_TIMEOUT_MS;
      }
      return DEFAULT_BUILD_TIMEOUT_MS;
    })()

  return {
    id,
    action,
    optional,
    timeoutMs: resolvedTimeoutMs
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

const templatePriority: Array<"tact" | "tolk" | "func"> = ["tact", "tolk", "func"];

function pickSeedTemplate(files: SandboxFile[], languages: string[]): "tact-empty" | "tolk-empty" | "func-empty" {
  const counts = {
    tact: 0,
    tolk: 0,
    func: 0
  };

  for (const file of files) {
    const language = detectLanguageFromPath(file.path);
    if (language === "tact" || language === "tolk" || language === "func") {
      counts[language] += 1;
    }
  }

  let selected: "tact" | "tolk" | "func" = "tact";
  let maxCount = -1;
  for (const candidate of templatePriority) {
    if ((counts[candidate] ?? 0) > maxCount) {
      selected = candidate;
      maxCount = counts[candidate];
    }
  }

  if (!languages.includes(selected) && languages.includes("tolk")) {
    selected = "tolk";
  } else if (!languages.includes(selected) && languages.includes("func")) {
    selected = "func";
  }

  if (selected === "tolk") {
    return "tolk-empty";
  }

  if (selected === "func") {
    return "func-empty";
  }

  return "tact-empty";
}

function blueprintPlan(languages: string[], profile: AuditProfile): SandboxPlan {
  const isDeep = profile === "deep";
  return {
    adapter: "blueprint",
    languages,
    reason: `Detected Blueprint project files (${profile} profile).`,
    bootstrapMode: "none",
    seedTemplate: null,
    unsupportedReasons: [],
    steps: [
      createStep("blueprint-build", "blueprint-build", false),
      createStep("blueprint-test", "blueprint-test", !isDeep),
      createStep("security-surface-scan", "security-surface-scan", false),
      createStep("security-rules-scan", "security-rules-scan", !isDeep)
    ]
  };
}

function singleLanguagePlan(
  language: string,
  files: SandboxFile[],
  profile: AuditProfile
): SandboxPlan {
  const seedTemplate = pickSeedTemplate(files, [language]);
  const isDeep = profile === "deep";
  const scanSteps = [
    createStep("security-surface-scan", "security-surface-scan", false),
    createStep("security-rules-scan", "security-rules-scan", !isDeep)
  ];

  switch (language) {
    case "tact":
      return {
        adapter: "tact",
        languages: [language],
        reason: `Detected Tact contract files (${profile} profile).`,
        bootstrapMode: "create-ton",
        seedTemplate,
        unsupportedReasons: [],
        steps: [
          createStep("bootstrap", "bootstrap-create-ton", false),
          createStep("tact-check", "tact-check", !isDeep),
          createStep("blueprint-build", "blueprint-build", false),
          ...scanSteps
        ]
      };
    case "func":
      return {
        adapter: "func",
        languages: [language],
        reason: `Detected FunC contract files (${profile} profile).`,
        bootstrapMode: "create-ton",
        seedTemplate,
        unsupportedReasons: [],
        steps: [
          createStep("bootstrap", "bootstrap-create-ton", false),
          createStep("func-check", "func-check", !isDeep),
          createStep("blueprint-build", "blueprint-build", true),
          ...scanSteps
        ]
      };
    case "tolk":
      return {
        adapter: "tolk",
        languages: [language],
        reason: `Detected Tolk contract files (${profile} profile).`,
        bootstrapMode: "create-ton",
        seedTemplate,
        unsupportedReasons: [],
        steps: [
          createStep("bootstrap", "bootstrap-create-ton", false),
          createStep("tolk-check", "tolk-check", !isDeep),
          createStep("blueprint-build", "blueprint-build", true),
          ...scanSteps
        ]
      };
    default:
      return {
        adapter: "none",
        languages: [language],
        reason: "Language not supported by sandbox adapter.",
        bootstrapMode: "none",
        seedTemplate: null,
        unsupportedReasons: [`Language '${language}' is not executable in sandbox v1.`],
        steps: []
      };
  }
}

function mixedPlan(files: SandboxFile[], languages: string[], profile: AuditProfile): SandboxPlan {
  const isDeep = profile === "deep";
  const steps: SandboxStep[] = [];
  const unsupportedReasons: string[] = [
    "Mixed-language execution runs with pinned toolchain only; project-specific dependencies are skipped."
  ];

  steps.push(createStep("bootstrap", "bootstrap-create-ton", false));
  if (languages.includes("tact")) {
    steps.push(createStep("tact-check", "tact-check", !isDeep));
  }
  if (languages.includes("func")) {
    steps.push(createStep("func-check", "func-check", !isDeep));
  }
  if (languages.includes("tolk")) {
    steps.push(createStep("tolk-check", "tolk-check", !isDeep));
  }
  steps.push(createStep("blueprint-build", "blueprint-build", true));
  steps.push(createStep("security-surface-scan", "security-surface-scan", false));
  steps.push(createStep("security-rules-scan", "security-rules-scan", !isDeep));

  return {
    adapter: "mixed",
    languages,
    reason: `Detected mixed TON language set without Blueprint metadata (${profile} profile).`,
    bootstrapMode: "create-ton",
    seedTemplate: pickSeedTemplate(files, languages),
    unsupportedReasons,
    steps
  };
}

export function planSandboxVerification(
  files: SandboxFile[],
  profile: AuditProfile = "deep"
): SandboxPlan {
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
      bootstrapMode: "none",
      seedTemplate: null,
      unsupportedReasons: ["No executable TON source files were found."],
      steps: []
    };
  }

  if (looksLikeBlueprint(normalized)) {
    return blueprintPlan(languages, profile);
  }

  if (languages.length === 1) {
    return singleLanguagePlan(languages[0]!, normalized, profile);
  }

  return mixedPlan(normalized, languages, profile);
}
