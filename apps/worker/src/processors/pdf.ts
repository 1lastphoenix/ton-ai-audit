import { Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { chromium } from "playwright";

import {
  auditRuns,
  findingInstances,
  findingTransitions,
  normalizeAuditReport,
  pdfExports,
  reportBrandingSchema,
  systemSettings,
  type JobPayloadMap
} from "@ton-audit/shared";

import { db } from "../db";
import { recordJobEvent } from "../job-events";
import { putObject } from "../s3";

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toSeverityBadgeClass(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return "sev-critical";
    case "high":
      return "sev-high";
    case "medium":
      return "sev-medium";
    case "low":
      return "sev-low";
    default:
      return "sev-info";
  }
}

function renderTaxonomy(payload: Record<string, unknown>) {
  const taxonomy = Array.isArray(payload.taxonomy) ? payload.taxonomy : [];
  if (!taxonomy.length) {
    return '<span class="pill">Unmapped</span>';
  }

  return taxonomy
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const standard = readNonEmptyString(row.standard) ?? "unknown";
      const id = readNonEmptyString(row.id) ?? "n/a";
      return `<span class="pill">${escapeHtml(`${standard.toUpperCase()}: ${id}`)}</span>`;
    })
    .join("");
}

function renderVerificationMatrix(report: ReturnType<typeof normalizeAuditReport>) {
  if (!report.verificationMatrix.length) {
    return `<p class="muted">No verification matrix available.</p>`;
  }

  return `
    <table class="matrix">
      <thead>
        <tr>
          <th>Step</th>
          <th>Status</th>
          <th>Summary</th>
          <th>Artifacts</th>
        </tr>
      </thead>
      <tbody>
        ${report.verificationMatrix
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.stepType)}</td>
                <td>${escapeHtml(entry.status)}</td>
                <td>${escapeHtml(entry.summary)}</td>
                <td>${escapeHtml(entry.artifactKeys.join(", ")) || "-"}</td>
              </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderTransitionSummary(transitions: Array<{ transition: string }>) {
  const totals = transitions.reduce<Record<string, number>>((acc, row) => {
    acc[row.transition] = (acc[row.transition] ?? 0) + 1;
    return acc;
  }, {});

  return `
    <div class="kpi-grid">
      <div class="kpi"><span>Opened</span><strong>${totals.opened ?? 0}</strong></div>
      <div class="kpi"><span>Resolved</span><strong>${totals.resolved ?? 0}</strong></div>
      <div class="kpi"><span>Regressed</span><strong>${totals.regressed ?? 0}</strong></div>
      <div class="kpi"><span>Unchanged</span><strong>${totals.unchanged ?? 0}</strong></div>
    </div>
  `;
}

function renderReportHtml(params: {
  report: ReturnType<typeof normalizeAuditReport>;
  findings: Array<Record<string, unknown>>;
  transitions: Array<{ transition: string }>;
  model: {
    used: string | null;
    primary: string | null;
    fallback: string | null;
  };
  variant: "client" | "internal";
  branding: ReturnType<typeof reportBrandingSchema.parse>;
}) {
  const report = params.report;
  const generatedAt = readNonEmptyString(report.generatedAt) ?? new Date().toISOString();
  const usedModel = params.model.used ?? "Unknown";
  const primaryModel = params.model.primary ?? "Unknown";
  const fallbackModel = params.model.fallback ?? "Unknown";
  const findings = params.findings;
  const isInternal = params.variant === "internal";

  const findingSections = findings
    .map((item, index) => {
      const payload = (item.payloadJson as Record<string, unknown>) ?? {};
      const evidence = (payload.evidence as Record<string, unknown>) ?? {};
      const cvss =
        payload.cvssV31 && typeof payload.cvssV31 === "object"
          ? (payload.cvssV31 as Record<string, unknown>)
          : null;
      const preconditions = Array.isArray(payload.preconditions)
        ? (payload.preconditions as string[]).map((value) => `<li>${escapeHtml(String(value))}</li>`).join("")
        : "";
      const verificationPlan = Array.isArray(payload.verificationPlan)
        ? (payload.verificationPlan as string[]).map((value) => `<li>${escapeHtml(String(value))}</li>`).join("")
        : "";
      const attackScenario = readNonEmptyString(payload.attackScenario) ?? "";
      const businessImpact = readNonEmptyString(payload.businessImpact) ?? "";
      const technicalImpact = readNonEmptyString(payload.technicalImpact) ?? "";

      return `
        <section class="finding">
          <div class="finding-head">
            <h3>${index + 1}. ${escapeHtml(String(payload.title ?? "Untitled finding"))}</h3>
            <span class="badge ${toSeverityBadgeClass(String(payload.severity ?? item.severity ?? "informational"))}">
              ${escapeHtml(String(payload.severity ?? item.severity ?? "informational"))}
            </span>
          </div>
          <p><strong>Summary:</strong> ${escapeHtml(String(payload.summary ?? ""))}</p>
          <p><strong>Impact:</strong> ${escapeHtml(String(payload.impact ?? ""))}</p>
          <p><strong>Likelihood:</strong> ${escapeHtml(String(payload.likelihood ?? ""))}</p>
          <p><strong>Exploit Path:</strong> ${escapeHtml(String(payload.exploitPath ?? ""))}</p>
          <p><strong>Remediation:</strong> ${escapeHtml(String(payload.remediation ?? ""))}</p>
          <p><strong>Fix Priority:</strong> ${escapeHtml(String(payload.fixPriority ?? "p2").toUpperCase())}</p>
          <p><strong>Confidence:</strong> ${escapeHtml(String(payload.confidence ?? ""))}</p>
          <p><strong>Taxonomy:</strong> ${renderTaxonomy(payload)}</p>
          ${
            cvss
              ? `<p><strong>CVSS v3.1:</strong> ${escapeHtml(String(cvss.vector ?? ""))} (base: ${escapeHtml(
                  String(cvss.baseScore ?? "")
                )})</p>`
              : "<p><strong>CVSS v3.1:</strong> not available</p>"
          }
          <p><strong>Evidence:</strong> ${escapeHtml(
            `${String(evidence.filePath ?? "unknown")}:${String(evidence.startLine ?? "?")}-${String(evidence.endLine ?? "?")}`
          )}</p>
          <pre>${escapeHtml(String(evidence.snippet ?? ""))}</pre>
          ${
            preconditions
              ? `<div><strong>Preconditions</strong><ul>${preconditions}</ul></div>`
              : ""
          }
          ${
            verificationPlan
              ? `<div><strong>Verification Plan</strong><ul>${verificationPlan}</ul></div>`
              : ""
          }
          ${attackScenario ? `<p><strong>Attack Scenario:</strong> ${escapeHtml(attackScenario)}</p>` : ""}
          ${businessImpact ? `<p><strong>Business Impact:</strong> ${escapeHtml(businessImpact)}</p>` : ""}
          ${technicalImpact ? `<p><strong>Technical Impact:</strong> ${escapeHtml(technicalImpact)}</p>` : ""}
        </section>
      `;
    })
    .join("\n");

  const internalAppendix = isInternal
    ? `
      <section class="section">
        <h2>Internal Appendix</h2>
        <p><strong>Verification Notes</strong></p>
        <ul>
          ${report.appendix.verificationNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
        ${
          report.appendix.internalNotes.length
            ? `<p><strong>Internal Notes</strong></p><ul>${report.appendix.internalNotes
                .map((note) => `<li>${escapeHtml(note)}</li>`)
                .join("")}</ul>`
            : ""
        }
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.branding.reportTitle)}</title>
  <style>
    :root {
      --brand-primary: ${escapeHtml(params.branding.primaryColor)};
      --brand-accent: ${escapeHtml(params.branding.accentColor)};
      --text: #0f172a;
      --muted: #475569;
      --line: #cbd5e1;
      --bg-soft: #f8fafc;
    }
    @page { size: A4; margin: 24px; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: var(--text); margin: 0; padding: 0; }
    .cover { page-break-after: always; min-height: 90vh; display: flex; flex-direction: column; justify-content: center; }
    .cover h1 { margin: 0 0 12px; font-size: 34px; color: var(--brand-primary); }
    .cover .meta { color: var(--muted); font-size: 13px; margin: 6px 0; }
    .section { margin-bottom: 22px; page-break-inside: avoid; }
    h2 { margin: 0 0 10px; color: var(--brand-primary); border-bottom: 1px solid var(--line); padding-bottom: 6px; }
    h3 { margin: 0; font-size: 16px; }
    .muted { color: var(--muted); }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
    .kpi { border: 1px solid var(--line); border-radius: 8px; background: var(--bg-soft); padding: 10px; }
    .kpi span { display: block; color: var(--muted); font-size: 11px; }
    .kpi strong { font-size: 18px; }
    .matrix { width: 100%; border-collapse: collapse; font-size: 12px; }
    .matrix th, .matrix td { border: 1px solid var(--line); padding: 7px; text-align: left; vertical-align: top; }
    .matrix thead th { background: var(--bg-soft); }
    .finding { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 16px; page-break-inside: avoid; }
    .finding-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 8px; }
    .badge { border-radius: 999px; padding: 3px 9px; font-size: 11px; text-transform: uppercase; border: 1px solid transparent; }
    .sev-critical { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
    .sev-high { background: #ffedd5; color: #9a3412; border-color: #fed7aa; }
    .sev-medium { background: #fef9c3; color: #854d0e; border-color: #fde68a; }
    .sev-low { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
    .sev-info { background: #e0f2fe; color: #0c4a6e; border-color: #bae6fd; }
    .pill { display: inline-block; border: 1px solid var(--line); background: var(--bg-soft); border-radius: 999px; padding: 2px 8px; margin-right: 6px; font-size: 11px; }
    pre { background: #f1f5f9; border: 1px solid var(--line); border-radius: 8px; padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
    ul { margin-top: 4px; }
  </style>
</head>
<body>
  <section class="cover">
    <p class="meta">${escapeHtml(params.branding.confidentialityNotice)}</p>
    <h1>${escapeHtml(params.branding.reportTitle)}</h1>
    <p class="meta"><strong>Issuer:</strong> ${escapeHtml(params.branding.issuerName)}</p>
    <p class="meta"><strong>Audit ID:</strong> ${escapeHtml(report.auditId)}</p>
    <p class="meta"><strong>Generated At:</strong> ${escapeHtml(generatedAt)}</p>
    <p class="meta"><strong>Variant:</strong> ${escapeHtml(params.variant)}</p>
    <p class="meta"><strong>Profile:</strong> ${escapeHtml(report.profile)}</p>
    <p class="meta">${escapeHtml(params.branding.legalDisclaimer)}</p>
  </section>

  <section class="section">
    <h2>Engagement Metadata & Scope</h2>
    <p><strong>Project ID:</strong> ${escapeHtml(report.projectId)}</p>
    <p><strong>Revision ID:</strong> ${escapeHtml(report.revisionId)}</p>
    <p><strong>AI/LLM Model Used:</strong> ${escapeHtml(usedModel)}</p>
    <p><strong>Primary Model:</strong> ${escapeHtml(primaryModel)}</p>
    <p><strong>Fallback Model:</strong> ${escapeHtml(fallbackModel)}</p>
    <p><strong>Scope:</strong> ${escapeHtml(report.methodology.scope.join(", "))}</p>
  </section>

  <section class="section">
    <h2>Executive Risk Posture</h2>
    <p>${escapeHtml(report.executiveSummary.overview)}</p>
    <div class="kpi-grid">
      <div class="kpi"><span>Critical</span><strong>${report.riskPosture.severityTotals.critical ?? 0}</strong></div>
      <div class="kpi"><span>High</span><strong>${report.riskPosture.severityTotals.high ?? 0}</strong></div>
      <div class="kpi"><span>Medium</span><strong>${report.riskPosture.severityTotals.medium ?? 0}</strong></div>
      <div class="kpi"><span>Low/Info</span><strong>${(report.riskPosture.severityTotals.low ?? 0) + (report.riskPosture.severityTotals.informational ?? 0)}</strong></div>
    </div>
    <p><strong>Overall Risk:</strong> ${escapeHtml(report.executiveSummary.overallRisk)}</p>
    <p><strong>CVSS Average:</strong> ${report.riskPosture.cvssAverage ?? "n/a"} | <strong>CVSS Max:</strong> ${report.riskPosture.maxCvssScore ?? "n/a"}</p>
  </section>

  <section class="section">
    <h2>Methodology</h2>
    <p>${escapeHtml(report.methodology.approach)}</p>
    <p><strong>Standards:</strong> ${escapeHtml(report.methodology.standards.join(", "))}</p>
    <p><strong>Limitations:</strong> ${escapeHtml(report.methodology.limitations.join(" | ")) || "-"}</p>
    <p><strong>Assumptions:</strong> ${escapeHtml(report.methodology.assumptions.join(" | ")) || "-"}</p>
  </section>

  <section class="section">
    <h2>Verification Matrix</h2>
    ${renderVerificationMatrix(report)}
  </section>

  <section class="section">
    <h2>Differential Analysis</h2>
    ${renderTransitionSummary(params.transitions)}
  </section>

  <section class="section">
    <h2>Detailed Findings</h2>
    ${findingSections}
  </section>

  ${internalAppendix}
  <footer class="section muted">audit.circulo.cloud</footer>
</body>
</html>`;
}

export function createPdfProcessor() {
  return async function pdf(job: Job<JobPayloadMap["pdf"]>) {
    const variant = job.data.variant ?? "client";

    await recordJobEvent({
      projectId: job.data.projectId,
      queue: "pdf",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data, variant }
    });

    let browser;
    try {
      const auditRun = await db.query.auditRuns.findFirst({
        where: and(eq(auditRuns.id, job.data.auditRunId), eq(auditRuns.projectId, job.data.projectId))
      });

      if (!auditRun) {
        throw new Error("Audit run not found");
      }

      await db
        .insert(pdfExports)
        .values({
          auditRunId: auditRun.id,
          variant,
          status: "running"
        })
        .onConflictDoUpdate({
          target: [pdfExports.auditRunId, pdfExports.variant],
          set: {
            status: "running",
            updatedAt: new Date()
          }
        });

      if (!auditRun.reportJson) {
        throw new Error("Audit report not found");
      }

      const report = normalizeAuditReport(auditRun.reportJson);
      const findings = await db.query.findingInstances.findMany({
        where: eq(findingInstances.auditRunId, auditRun.id)
      });
      const transitions = await db.query.findingTransitions.findMany({
        where: eq(findingTransitions.toAuditRunId, auditRun.id)
      });
      const reportModel =
        report.model && typeof report.model === "object"
          ? (report.model as Record<string, unknown>)
          : {};

      const brandingSetting = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, "pdf_report_branding")
      });
      const branding = reportBrandingSchema.parse(
        (brandingSetting?.value as Record<string, unknown> | undefined) ?? {}
      );

      const html = renderReportHtml({
        report,
        findings: findings as unknown as Array<Record<string, unknown>>,
        transitions: transitions.map((row) => ({ transition: row.transition })),
        variant,
        branding,
        model: {
          used: readNonEmptyString(reportModel.used),
          primary: readNonEmptyString(reportModel.primary) ?? auditRun.primaryModelId,
          fallback:
            readNonEmptyString(reportModel.fallback) ?? auditRun.fallbackModelId
        }
      });

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "pdf",
        jobId: String(job.id),
        event: "progress",
        payload: {
          auditRunId: auditRun.id,
          phase: "pdf-render",
          status: "started",
          variant,
          findingCount: findings.length
        }
      });

      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#64748b;">${escapeHtml(report.auditId)} · ${escapeHtml(variant.toUpperCase())}</div>`,
        footerTemplate:
          '<div style="font-size:9px;width:100%;text-align:center;color:#64748b;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
        margin: {
          top: "40px",
          right: "24px",
          bottom: "36px",
          left: "24px"
        }
      });

      const s3Key = `pdf/${auditRun.id}/${variant}/${Date.now()}.pdf`;
      await putObject({
        key: s3Key,
        body: pdfBuffer,
        contentType: "application/pdf"
      });

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "pdf",
        jobId: String(job.id),
        event: "progress",
        payload: {
          auditRunId: auditRun.id,
          phase: "pdf-render",
          status: "completed",
          variant,
          s3Key
        }
      });

      await db
        .update(pdfExports)
        .set({
          status: "completed",
          s3Key,
          generatedAt: new Date(),
          expiresAt: null,
          updatedAt: new Date()
        })
        .where(and(eq(pdfExports.auditRunId, auditRun.id), eq(pdfExports.variant, variant)));

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "pdf",
        jobId: String(job.id),
        event: "completed",
        payload: { auditRunId: auditRun.id, s3Key, variant }
      });

      return { auditRunId: auditRun.id, s3Key, variant };
    } catch (error) {
      await db
        .update(pdfExports)
        .set({
          status: "failed",
          updatedAt: new Date()
        })
        .where(
          and(eq(pdfExports.auditRunId, job.data.auditRunId), eq(pdfExports.variant, variant))
        );

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "pdf",
        jobId: String(job.id),
        event: "progress",
        payload: {
          auditRunId: job.data.auditRunId,
          phase: "pdf-render",
          status: "failed",
          variant,
          message: error instanceof Error ? error.message : "Unknown pdf render error"
        }
      });

      throw error;
    } finally {
      await browser?.close();
    }
  };
}
