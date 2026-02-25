import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readComposeServiceNames(composeText: string) {
  const lines = composeText.split(/\r?\n/);
  const servicesIndex = lines.findIndex((line) => line.trim() === "services:");
  if (servicesIndex < 0) {
    return [];
  }

  const serviceNames: string[] = [];

  for (let index = servicesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    if (/^[^\s]/.test(line)) {
      break;
    }

    const serviceMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (serviceMatch?.[1]) {
      serviceNames.push(serviceMatch[1]);
    }
  }

  return serviceNames;
}

describe("local docker compose dev services", () => {
  it("keeps compose infra-only so web and worker run on host", () => {
    const composePath = path.resolve(process.cwd(), "..", "..", "docker-compose.yml");
    const compose = fs.readFileSync(composePath, "utf8");

    const services = readComposeServiceNames(compose);

    expect(services).toEqual(
      expect.arrayContaining([
        "postgres",
        "redis",
        "minio",
        "sandbox-runner",
        "lsp-service"
      ])
    );
    expect(services).not.toContain("web");
    expect(services).not.toContain("worker");
  });
});