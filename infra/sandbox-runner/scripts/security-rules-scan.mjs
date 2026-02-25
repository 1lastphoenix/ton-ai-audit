import { collectSourceFiles, readFileLines, clipSnippet, countBySeverity, writeScanPayload } from "./_scan-utils.mjs";

const rules = [
  {
    ruleId: "TON-RULE-001",
    title: "Unchecked Raw Message Send",
    severity: "high",
    pattern: /\bsend_raw_message\b/i,
    remediation:
      "Verify destination, bounce flags, and mode bits before forwarding raw messages."
  },
  {
    ruleId: "TON-RULE-002",
    title: "Manual Message Acceptance Path",
    severity: "medium",
    pattern: /\baccept_message\b/i,
    remediation:
      "Guard accept_message usage with explicit caller/authorization checks and gas assumptions."
  },
  {
    ruleId: "TON-RULE-003",
    title: "Potential Weak Randomness Source",
    severity: "medium",
    pattern: /\b(random|rand|block_lt|now\s*\()/i,
    remediation:
      "Avoid deterministic chain values as entropy for security-critical decisions."
  },
  {
    ruleId: "TON-RULE-004",
    title: "Unbounded Loop Candidate",
    severity: "medium",
    pattern: /\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/i,
    remediation:
      "Bound loops or add explicit limits to prevent gas exhaustion and denial-of-service paths."
  },
  {
    ruleId: "TON-RULE-005",
    title: "Assertion-Driven Control Flow",
    severity: "low",
    pattern: /\bthrow\s*\(|\bthrowif\b/i,
    remediation:
      "Ensure throw paths expose stable error semantics and do not leak exploitable branch behavior."
  }
];

async function main() {
  const diagnostics = [];
  const files = await collectSourceFiles();

  for (const absolutePath of files) {
    const file = await readFileLines(absolutePath);

    for (let index = 0; index < file.lines.length; index += 1) {
      const line = file.lines[index] ?? "";

      for (const rule of rules) {
        if (!rule.pattern.test(line)) {
          continue;
        }

        diagnostics.push({
          ruleId: rule.ruleId,
          title: rule.title,
          severity: rule.severity,
          filePath: file.filePath,
          startLine: index + 1,
          endLine: index + 1,
          snippet: clipSnippet(line),
          remediation: rule.remediation,
          confidence: 0.72
        });
      }
    }
  }

  writeScanPayload({
    scanner: "security-rules-scan",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: `${diagnostics.length} diagnostics produced by deterministic rule-pack scan.`,
    bySeverity: countBySeverity(diagnostics),
    diagnostics
  });
}

main().catch((error) => {
  writeScanPayload({
    scanner: "security-rules-scan",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: `security-rules-scan failed: ${error instanceof Error ? error.message : "unknown error"}`,
    diagnostics: []
  });
  process.exitCode = 1;
});
