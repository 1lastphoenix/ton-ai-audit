import { collectSourceFiles, readFileLines, clipSnippet, countBySeverity, writeScanPayload } from "./_scan-utils.mjs";

const detectors = [
  {
    ruleId: "TON-SURFACE-001",
    title: "External Entry Point Exposed",
    severity: "informational",
    pattern: /\breceive\s*\(|\bexternal\s*\(|\brecv_external\b/i,
    remediation:
      "Document caller assumptions and validate all externally reachable handlers."
  },
  {
    ruleId: "TON-SURFACE-002",
    title: "Internal Message Handler Exposed",
    severity: "low",
    pattern: /\brecv_internal\b|\breceive\s*\(\s*internal/i,
    remediation:
      "Ensure internal handlers enforce expected sender and message layout constraints."
  },
  {
    ruleId: "TON-SURFACE-003",
    title: "Privileged Code Mutation Primitive",
    severity: "high",
    pattern: /\bset_code\b|\bset_c3\b/i,
    remediation:
      "Gate code-upgrade primitives behind strict access control and explicit governance checks."
  },
  {
    ruleId: "TON-SURFACE-004",
    title: "Value Transfer Primitive",
    severity: "medium",
    pattern: /\bsend_raw_message\b|\bsend\s*\(/i,
    remediation:
      "Validate transfer destination and value constraints to prevent draining and unintended forwarding."
  }
];

async function main() {
  const diagnostics = [];
  const files = await collectSourceFiles();

  for (const absolutePath of files) {
    const file = await readFileLines(absolutePath);

    for (let index = 0; index < file.lines.length; index += 1) {
      const line = file.lines[index] ?? "";

      for (const detector of detectors) {
        if (!detector.pattern.test(line)) {
          continue;
        }

        diagnostics.push({
          ruleId: detector.ruleId,
          title: detector.title,
          severity: detector.severity,
          filePath: file.filePath,
          startLine: index + 1,
          endLine: index + 1,
          snippet: clipSnippet(line),
          remediation: detector.remediation,
          confidence: 0.68
        });
      }
    }
  }

  const exposedFiles = [...new Set(diagnostics.map((item) => item.filePath))];

  writeScanPayload({
    scanner: "security-surface-scan",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: `${diagnostics.length} surface diagnostics across ${exposedFiles.length} file(s).`,
    bySeverity: countBySeverity(diagnostics),
    attackSurface: {
      touchedFiles: exposedFiles,
      detectorCount: detectors.length
    },
    diagnostics
  });
}

main().catch((error) => {
  writeScanPayload({
    scanner: "security-surface-scan",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: `security-surface-scan failed: ${error instanceof Error ? error.message : "unknown error"}`,
    diagnostics: []
  });
  process.exitCode = 1;
});
