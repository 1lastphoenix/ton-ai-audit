import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";

const PORT = Number(process.env.PORT || 3003);
const MAX_FILES = Number(process.env.SANDBOX_MAX_FILES || 300);
const MAX_TOTAL_BYTES = Number(process.env.SANDBOX_MAX_TOTAL_BYTES || 25 * 1024 * 1024);
const MAX_REQUEST_BYTES = Number(process.env.SANDBOX_MAX_REQUEST_BYTES || 30 * 1024 * 1024);
const EXECUTION_MODE = process.env.SANDBOX_EXECUTION_MODE === "local" ? "local" : "docker";
const DOCKER_IMAGE = process.env.SANDBOX_DOCKER_IMAGE || "infra-sandbox-runner:latest";

const pinnedToolchain = JSON.parse(
  await readFile(new URL("./pinned-toolchain.json", import.meta.url), "utf8")
);

const allowedActions = new Set([
  "bootstrap-create-ton",
  "blueprint-build",
  "blueprint-test",
  "tact-check",
  "func-check",
  "tolk-check"
]);

const bootstrapTemplates = new Set(["tact-empty", "tolk-empty", "func-empty"]);

const actionCommandMap = {
  "blueprint-build": { command: "blueprint", args: ["build"] },
  "blueprint-test": { command: "blueprint", args: ["test"] },
  "tact-check": { command: "tact", args: ["--version"] },
  "func-check": { command: "func-js", args: ["--version"] },
  "tolk-check": { command: "tolk-js", args: ["--help"] }
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(new Error(`Request body too large. Max ${MAX_REQUEST_BYTES}`));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}

function isUnsafePath(inputPath) {
  if (!inputPath || inputPath.includes("\0")) {
    return true;
  }

  const normalized = inputPath.replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return true;
  }

  const cleaned = path.posix.normalize(normalized);
  return cleaned.split("/").some((segment) => segment === "..");
}

function validateRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid JSON payload");
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const rawMetadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};

  if (files.length > MAX_FILES) {
    throw new Error(`Max files is ${MAX_FILES}`);
  }

  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== "object") {
      throw new Error("Invalid file payload");
    }
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("Invalid file payload fields");
    }
    if (isUnsafePath(file.path)) {
      throw new Error(`Unsafe file path: ${file.path}`);
    }
    totalBytes += Buffer.byteLength(file.content, "utf8");
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`Total payload too large: ${MAX_TOTAL_BYTES}`);
    }
  }

  const metadata = {
    projectId: typeof rawMetadata.projectId === "string" ? rawMetadata.projectId : null,
    revisionId: typeof rawMetadata.revisionId === "string" ? rawMetadata.revisionId : null,
    adapter: typeof rawMetadata.adapter === "string" ? rawMetadata.adapter : "none",
    bootstrapMode: rawMetadata.bootstrapMode === "create-ton" ? "create-ton" : "none",
    seedTemplate:
      typeof rawMetadata.seedTemplate === "string" && bootstrapTemplates.has(rawMetadata.seedTemplate)
        ? rawMetadata.seedTemplate
        : "tact-empty"
  };

  const normalizedSteps = steps.map((step) => {
    if (!step || typeof step !== "object") {
      throw new Error("Invalid step payload");
    }

    if (typeof step.id !== "string" || !step.id.trim()) {
      throw new Error("Step id is required");
    }

    if (typeof step.action !== "string" || !allowedActions.has(step.action)) {
      throw new Error(`Invalid step action: ${String(step.action)}`);
    }

    const timeoutMs =
      typeof step.timeoutMs === "number" && Number.isFinite(step.timeoutMs)
        ? Math.max(1_000, Math.min(step.timeoutMs, 20 * 60 * 1000))
        : 60_000;

    return {
      id: step.id.trim(),
      action: step.action,
      timeoutMs,
      optional: Boolean(step.optional)
    };
  });

  return {
    files,
    steps: normalizedSteps,
    metadata
  };
}

async function materializeWorkspace(files) {
  const workspaceId = randomUUID();
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "ton-sandbox-"));

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/");
    const target = path.join(workspaceDir, normalizedPath);
    const relative = path.relative(workspaceDir, target).replace(/\\/g, "/");
    if (relative.startsWith("../") || relative === "..") {
      throw new Error(`Unsafe file path while materializing: ${file.path}`);
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }

  return { workspaceId, workspaceDir };
}

async function ensureDeterministicBlueprintWorkspace(workspaceDir, metadata) {
  const packageJsonPath = path.join(workspaceDir, "package.json");
  const blueprintConfigPath = path.join(workspaceDir, "blueprint.config.ts");

  const packageJson = {
    name: "sandbox-ton-project",
    private: true,
    version: "0.1.0",
    scripts: {
      build: "blueprint build",
      test: "blueprint test"
    },
    devDependencies: {
      "@ton/blueprint": pinnedToolchain.blueprintVersion,
      "create-ton": pinnedToolchain.createTonVersion,
      "@tact-lang/compiler": pinnedToolchain.tactCompilerVersion,
      "@ton/tolk-js": pinnedToolchain.tolkJsVersion,
      "@ton-community/func-js": pinnedToolchain.funcJsVersion,
      "@ton/sandbox": pinnedToolchain.tonSandboxVersion,
      "@ton/core": pinnedToolchain.tonCoreVersion,
      "@ton/ton": pinnedToolchain.tonVersion,
      "@ton/crypto": pinnedToolchain.tonCryptoVersion
    }
  };

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");

  const seedTemplate = metadata.seedTemplate || "tact-empty";
  await writeFile(
    blueprintConfigPath,
    [
      "const config = {",
      "  contracts: \"contracts\",",
      "  tests: \"tests\",",
      `  template: "${seedTemplate}"`,
      "};",
      "",
      "export default config;"
    ].join("\n"),
    "utf8"
  );

  await mkdir(path.join(workspaceDir, "contracts"), { recursive: true });
  await mkdir(path.join(workspaceDir, "tests"), { recursive: true });
}

function runProcess(params) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      shell: false,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP
      }
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, params.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 1_000_000) {
        stdout = stdout.slice(-1_000_000);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 1_000_000) {
        stderr = stderr.slice(-1_000_000);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        status: "failed",
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Math.max(Date.now() - startedAt, 1)
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        status: timedOut ? "timeout" : code === 0 ? "completed" : "failed",
        exitCode: code,
        stdout,
        stderr,
        durationMs: Math.max(Date.now() - startedAt, 1)
      });
    });
  });
}

function runMappedCommand(step, workspaceDir, mappedCommand) {
  if (EXECUTION_MODE === "local") {
    return runProcess({
      command: mappedCommand.command,
      args: mappedCommand.args,
      cwd: workspaceDir,
      timeoutMs: step.timeoutMs
    });
  }

  const dockerArgs = [
    "run",
    "--rm",
    "--network",
    "none",
    "--cpus",
    "2",
    "--memory",
    "2g",
    "--pids-limit",
    "256",
    "-v",
    `${workspaceDir}:/workspace`,
    "-w",
    "/workspace",
    DOCKER_IMAGE,
    mappedCommand.command,
    ...mappedCommand.args
  ];

  return runProcess({
    command: "docker",
    args: dockerArgs,
    cwd: workspaceDir,
    timeoutMs: step.timeoutMs
  });
}

async function executeStep(step, workspaceDir, metadata) {
  if (step.action === "bootstrap-create-ton") {
    if (metadata.bootstrapMode !== "create-ton") {
      return {
        id: step.id,
        action: step.action,
        command: "create-ton",
        args: ["--help"],
        status: "skipped",
        exitCode: 0,
        stdout: "Bootstrap skipped: project already contains Blueprint metadata.",
        stderr: "",
        durationMs: 1
      };
    }

    await ensureDeterministicBlueprintWorkspace(workspaceDir, metadata);
    const check = await runMappedCommand(step, workspaceDir, {
      command: "create-ton",
      args: ["--help"]
    });

    return {
      id: step.id,
      action: step.action,
      command: "create-ton",
      args: ["--help"],
      status: check.status,
      exitCode: check.exitCode,
      stdout: [check.stdout, `Seed template: ${metadata.seedTemplate}`].filter(Boolean).join("\n"),
      stderr: check.stderr,
      durationMs: check.durationMs
    };
  }

  const mapped = actionCommandMap[step.action];
  if (!mapped) {
    return {
      id: step.id,
      action: step.action,
      command: "unknown",
      args: [],
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: `No command mapping for action '${step.action}'`,
      durationMs: 1
    };
  }

  const result = await runMappedCommand(step, workspaceDir, mapped);
  return {
    id: step.id,
    action: step.action,
    command: mapped.command,
    args: mapped.args,
    status: result.status,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  };
}

async function executeSteps(validPayload, workspaceDir) {
  const results = [];
  for (const step of validPayload.steps) {
    const result = await executeStep(step, workspaceDir, validPayload.metadata);
    const shouldSkipFailure = result.status !== "completed" && step.optional;

    if (shouldSkipFailure) {
      results.push({
        ...result,
        status: "skipped",
        stderr: result.stderr || "Optional step failed and was skipped."
      });
      continue;
    }

    results.push(result);

    if (result.status === "failed" || result.status === "timeout") {
      break;
    }
  }

  return results;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, {
      ok: true,
      mode: EXECUTION_MODE,
      pinnedToolchain
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/execute") {
    writeJson(response, 404, { error: "Not found" });
    return;
  }

  let workspaceDir = null;
  try {
    const rawBody = await readBody(request);
    const payload = JSON.parse(rawBody);
    const validPayload = validateRequest(payload);
    const materialized = await materializeWorkspace(validPayload.files);
    workspaceDir = materialized.workspaceDir;

    const results = await executeSteps(validPayload, workspaceDir);

    writeJson(response, 200, {
      workspaceId: materialized.workspaceId,
      mode: EXECUTION_MODE,
      results
    });
  } catch (error) {
    writeJson(response, 400, {
      error: error instanceof Error ? error.message : "Unknown sandbox error"
    });
  } finally {
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sandbox-runner listening on :${PORT} (mode=${EXECUTION_MODE})`);
});
