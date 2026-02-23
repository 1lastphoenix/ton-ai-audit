import { Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { chromium } from "playwright";

import {
  auditRuns,
  findingInstances,
  pdfExports,
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

function renderReportHtml(params: {
  report: Record<string, unknown>;
  findings: Array<Record<string, unknown>>;
}) {
  const report = params.report;
  const findings = params.findings;

  const findingSections = findings
    .map((item, index) => {
      const payload = (item.payloadJson as Record<string, unknown>) ?? {};
      const evidence = (payload.evidence as Record<string, unknown>) ?? {};
      return `
        <section class="finding">
          <h3>${index + 1}. ${escapeHtml(String(payload.title ?? "Untitled finding"))}</h3>
          <p><strong>Severity:</strong> ${escapeHtml(String(payload.severity ?? item.severity ?? "unknown"))}</p>
          <p><strong>Summary:</strong> ${escapeHtml(String(payload.summary ?? ""))}</p>
          <p><strong>Impact:</strong> ${escapeHtml(String(payload.impact ?? ""))}</p>
          <p><strong>Likelihood:</strong> ${escapeHtml(String(payload.likelihood ?? ""))}</p>
          <p><strong>Exploit Path:</strong> ${escapeHtml(String(payload.exploitPath ?? ""))}</p>
          <p><strong>Remediation:</strong> ${escapeHtml(String(payload.remediation ?? ""))}</p>
          <p><strong>Evidence:</strong> ${escapeHtml(
            `${String(evidence.filePath ?? "unknown")}:${String(evidence.startLine ?? "?")}-${String(evidence.endLine ?? "?")}`
          )}</p>
          <pre>${escapeHtml(String(evidence.snippet ?? ""))}</pre>
        </section>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>TON Audit Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; padding: 32px; }
    h1 { margin-bottom: 8px; }
    h2 { margin-top: 28px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }
    .meta { color: #475569; font-size: 12px; margin-bottom: 24px; }
    .finding { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin-bottom: 16px; page-break-inside: avoid; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>TON Smart Contract Security Audit</h1>
  <p class="meta">Generated at ${escapeHtml(new Date().toISOString())}</p>
  <h2>Scope</h2>
  <pre>${escapeHtml(JSON.stringify((report.summary as Record<string, unknown>)?.scope ?? [], null, 2))}</pre>
  <h2>Methodology</h2>
  <p>${escapeHtml(String((report.summary as Record<string, unknown>)?.methodology ?? ""))}</p>
  <h2>Overview</h2>
  <p>${escapeHtml(String((report.summary as Record<string, unknown>)?.overview ?? ""))}</p>
  <h2>Findings</h2>
  ${findingSections}
</body>
</html>`;
}

export function createPdfProcessor() {
  return async function pdf(job: Job<JobPayloadMap["pdf"]>) {
    await recordJobEvent({
      projectId: job.data.projectId,
      queue: "pdf",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data }
    });

    const auditRun = await db.query.auditRuns.findFirst({
      where: and(eq(auditRuns.id, job.data.auditRunId), eq(auditRuns.projectId, job.data.projectId))
    });

    if (!auditRun?.reportJson) {
      throw new Error("Audit report not found");
    }

    const findings = await db.query.findingInstances.findMany({
      where: eq(findingInstances.auditRunId, auditRun.id)
    });

    const html = renderReportHtml({
      report: auditRun.reportJson,
      findings: findings as unknown as Array<Record<string, unknown>>
    });

    await db
      .insert(pdfExports)
      .values({
        auditRunId: auditRun.id,
        status: "running"
      })
      .onConflictDoUpdate({
        target: pdfExports.auditRunId,
        set: {
          status: "running",
          updatedAt: new Date()
        }
      });

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "24px",
          right: "24px",
          bottom: "24px",
          left: "24px"
        }
      });

      const s3Key = `pdf/${auditRun.id}/${Date.now()}.pdf`;
      await putObject({
        key: s3Key,
        body: pdfBuffer,
        contentType: "application/pdf"
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
        .where(eq(pdfExports.auditRunId, auditRun.id));

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "pdf",
        jobId: String(job.id),
        event: "completed",
        payload: { auditRunId: auditRun.id, s3Key }
      });

      return { auditRunId: auditRun.id, s3Key };
    } catch (error) {
      await db
        .update(pdfExports)
        .set({
          status: "failed",
          updatedAt: new Date()
        })
        .where(eq(pdfExports.auditRunId, auditRun.id));

      throw error;
    } finally {
      await browser?.close();
    }
  };
}
