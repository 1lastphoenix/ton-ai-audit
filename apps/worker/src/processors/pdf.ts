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

const FINAL_PDF_VARIANT = "internal" as const;

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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
}

function renderSafeInlineLink(label: string, href: string) {
  const safeUrl = safeExternalLink(href);
  const escapedLabel = escapeHtml(label.trim());
  if (!safeUrl) {
    return escapedLabel;
  }

  const escapedUrl = escapeHtml(safeUrl);
  return `<a href="${escapedUrl}" target="_blank" rel="noreferrer">${escapedLabel}</a>`;
}

function protectInlineMarkdownTokens(value: string) {
  const tokens: string[] = [];
  const reserveToken = (html: string) => {
    const key = `%%TOKEN${tokens.length}%%`;
    tokens.push(html);
    return key;
  };

  let output = value;
  output = output.replace(/`([^`\n]+)`/g, (_match, code: string) =>
    reserveToken(`<code>${escapeHtml(code)}</code>`)
  );
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) =>
    reserveToken(renderSafeInlineLink(label, href.trim()))
  );

  return {
    output,
    tokens
  };
}

function restoreInlineMarkdownTokens(value: string, tokens: string[]) {
  return value.replace(/%%TOKEN(\d+)%%/g, (_match, rawIndex: string) => {
    const index = Number.parseInt(rawIndex, 10);
    return Number.isFinite(index) && tokens[index] ? tokens[index] : "";
  });
}

function renderInlineMarkdown(input: string) {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const protectedContent = protectInlineMarkdownTokens(normalized);
  let escaped = escapeHtml(protectedContent.output);

  escaped = escaped.replace(/^#{1,6}\s+/gm, "");
  escaped = escaped.replace(/(^|[\s(])&gt;\s+/g, "$1");
  escaped = escaped.replace(/(\*\*|__)([^*_\n][^*\n]*?)\1/g, "<strong>$2</strong>");
  escaped = escaped.replace(/(\*|_)([^*_\n][^*\n]*?)\1/g, "<em>$2</em>");
  escaped = escaped.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");

  // Remove residual markdown markers so literals like **** or __ do not leak into PDF text.
  escaped = escaped.replace(/(^|[\s(])[*_]{1,4}(?=[\s).,!?:;]|$)/g, "$1");
  escaped = escaped.replace(/[*]{2,}/g, "");
  escaped = escaped.replace(/_{2,}/g, "");
  escaped = escaped.replace(/(^|[\s(])\*([^<>\n]{1,120}?)(?=[\s).,!?:;]|$)/g, "$1$2");
  escaped = escaped.replace(/(^|[\s(])_([^<>\n]{1,120}?)(?=[\s).,!?:;]|$)/g, "$1$2");

  return restoreInlineMarkdownTokens(escaped, protectedContent.tokens);
}

function renderRichTextBlock(value: unknown, fallback = "n/a") {
  const text = readNonEmptyString(value);
  if (!text) {
    return `<p class="muted">${escapeHtml(fallback)}</p>`;
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (!lines.length) {
        return "";
      }

      const isUnordered = lines.every((line) => line.startsWith("- ") || line.startsWith("* "));
      if (isUnordered) {
        return `<ul class="list">${lines
          .map((line) => `<li>${renderInlineMarkdown(line.slice(2).trim())}</li>`)
          .join("")}</ul>`;
      }

      const isOrdered = lines.every((line) => /^\d+\.\s+/.test(line));
      if (isOrdered) {
        return `<ol class="list">${lines
          .map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`)
          .join("")}</ol>`;
      }

      return `<p>${lines.map((line) => renderInlineMarkdown(line)).join("<br />")}</p>`;
    })
    .join("");
}

function renderList(items: string[], emptyLabel = "None") {
  if (!items.length) {
    return `<p class="muted">${escapeHtml(emptyLabel)}</p>`;
  }

  return `<ul class="list">${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`;
}

function renderTagList(items: string[], emptyLabel = "None") {
  if (!items.length) {
    return `<span class="muted">${escapeHtml(emptyLabel)}</span>`;
  }

  return items.map((item) => `<span class="pill">${renderInlineMarkdown(item)}</span>`).join("");
}

function renderPlainCell(value: unknown, fallback = "n/a") {
  const text = readNonEmptyString(value);
  return text ? renderInlineMarkdown(text) : `<span class="muted">${escapeHtml(fallback)}</span>`;
}

function formatDateLabel(value: unknown) {
  const raw = readNonEmptyString(value);
  if (!raw) {
    return "n/a";
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return parsed.toISOString().replace("T", " ").replace("Z", " UTC");
}

function safeExternalLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // ignore malformed URLs
  }

  return null;
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
                <td>${escapeHtml(entry.status.toUpperCase())}</td>
                <td>${renderInlineMarkdown(entry.summary)}</td>
                <td>${entry.artifactKeys.length ? renderTagList(entry.artifactKeys) : '<span class="muted">None</span>'}</td>
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

  const rows = [
    { label: "Opened", value: totals.opened ?? 0 },
    { label: "Resolved", value: totals.resolved ?? 0 },
    { label: "Regressed", value: totals.regressed ?? 0 },
    { label: "Unchanged", value: totals.unchanged ?? 0 }
  ];

  return `
    <div class="kpi-grid">
      ${rows
        .map(
          (row) => `
            <div class="kpi"><span>${escapeHtml(row.label)}</span><strong>${row.value}</strong></div>
          `
        )
        .join("")}
    </div>
    <table class="matrix">
      <thead>
        <tr>
          <th>Transition</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.label)}</td>
                <td>${row.value}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
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
  branding: ReturnType<typeof reportBrandingSchema.parse>;
}) {
  const report = params.report;
  const generatedAt = formatDateLabel(report.generatedAt);
  const usedModel = params.model.used ?? "Unknown";
  const primaryModel = params.model.primary ?? "Unknown";
  const fallbackModel = params.model.fallback ?? "Unknown";
  const findings = params.findings;
  const logoUrl = readNonEmptyString(params.branding.issuerLogoUrl);

  const tocEntries = [
    { index: "1", title: "Cover and Confidentiality", target: "cover" },
    { index: "2", title: "Engagement Metadata and Scope", target: "engagement" },
    { index: "3", title: "Executive Risk Posture", target: "risk-posture" },
    { index: "4", title: "Methodology and Verification Matrix", target: "methodology" },
    { index: "5", title: "Taxonomy and Quality Gates", target: "taxonomy" },
    { index: "6", title: "Differential Analysis", target: "differential" },
    {
      index: "7",
      title: `Detailed Findings (${findings.length})`,
      target: "detailed-findings"
    },
    { index: "8", title: "Technical Appendix", target: "appendix" }
  ];

  const findingSections = findings
    .map((item, index) => {
      const payload = (item.payloadJson as Record<string, unknown>) ?? {};
      const evidence =
        payload.evidence && typeof payload.evidence === "object"
          ? (payload.evidence as Record<string, unknown>)
          : {};
      const cvss =
        payload.cvssV31 && typeof payload.cvssV31 === "object"
          ? (payload.cvssV31 as Record<string, unknown>)
          : null;
      const severity = readNonEmptyString(payload.severity ?? item.severity) ?? "informational";
      const confidence =
        typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
          ? `${Math.round(payload.confidence * 100)}%`
          : "n/a";
      const cvssScore =
        typeof cvss?.baseScore === "number" && Number.isFinite(cvss.baseScore)
          ? cvss.baseScore.toFixed(1)
          : "n/a";
      const cvssVector = readNonEmptyString(cvss?.vector) ?? "n/a";
      const preconditions = toStringArray(payload.preconditions);
      const verificationPlan = toStringArray(payload.verificationPlan);
      const affectedContracts = toStringArray(payload.affectedContracts);
      const references = toStringArray(payload.references);
      const taxonomy = Array.isArray(payload.taxonomy) ? payload.taxonomy : [];
      const fixPriority = (readNonEmptyString(payload.fixPriority) ?? "p2").toUpperCase();
      const lineRange =
        typeof evidence.startLine === "number" && typeof evidence.endLine === "number"
          ? `${evidence.startLine}-${evidence.endLine}`
          : "n/a";
      const taxonomyTable = taxonomy.length
        ? `
            <table class="matrix matrix-compact">
              <thead>
                <tr>
                  <th>Standard</th>
                  <th>ID</th>
                  <th>Title</th>
                </tr>
              </thead>
              <tbody>
                ${taxonomy
                  .map((entry) => {
                    const row =
                      entry && typeof entry === "object"
                        ? (entry as Record<string, unknown>)
                        : {};
                    return `
                      <tr>
                        <td>${escapeHtml((readNonEmptyString(row.standard) ?? "unknown").toUpperCase())}</td>
                        <td>${escapeHtml(readNonEmptyString(row.id) ?? "n/a")}</td>
                        <td>${renderPlainCell(row.title)}</td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          `
        : `<p class="muted">No taxonomy mapping provided.</p>`;
      const referencesList = references.length
        ? `<ol class="list references">${references
            .map((url) => {
              const safeUrl = safeExternalLink(url);
              if (!safeUrl) {
                return `<li>${renderInlineMarkdown(url)}</li>`;
              }

              const escaped = escapeHtml(safeUrl);
              return `<li><a href="${escaped}" target="_blank" rel="noreferrer">${escaped}</a></li>`;
            })
            .join("")}</ol>`
        : `<p class="muted">No external references.</p>`;

      return `
        <section class="finding">
          <div class="finding-head">
            <h3>${index + 1}. ${renderInlineMarkdown(readNonEmptyString(payload.title) ?? "Untitled finding")}</h3>
            <span class="badge ${toSeverityBadgeClass(severity)}">
              ${escapeHtml(severity.toUpperCase())}
            </span>
          </div>

          <table class="matrix matrix-compact finding-meta">
            <tbody>
              <tr>
                <th>Fix Priority</th>
                <td>${escapeHtml(fixPriority)}</td>
                <th>Confidence</th>
                <td>${escapeHtml(confidence)}</td>
              </tr>
              <tr>
                <th>CVSS v3.1</th>
                <td>${escapeHtml(cvssScore)} (${escapeHtml(cvssVector)})</td>
                <th>Evidence Range</th>
                <td>${escapeHtml(lineRange)}</td>
              </tr>
              <tr>
                <th>Affected Contracts</th>
                <td colspan="3">${renderTagList(affectedContracts, "None specified")}</td>
              </tr>
            </tbody>
          </table>

          <h4>Summary</h4>
          ${renderRichTextBlock(payload.summary)}
          <h4>Likelihood</h4>
          ${renderRichTextBlock(payload.likelihood)}
          <h4>Impact</h4>
          ${renderRichTextBlock(payload.impact)}
          <h4>Business Impact</h4>
          ${renderRichTextBlock(payload.businessImpact)}
          <h4>Technical Impact</h4>
          ${renderRichTextBlock(payload.technicalImpact)}
          <h4>Exploitability</h4>
          ${renderRichTextBlock(payload.exploitability)}
          <h4>Attack Scenario</h4>
          ${renderRichTextBlock(payload.attackScenario)}
          <h4>Exploit Path</h4>
          ${renderRichTextBlock(payload.exploitPath)}
          <h4>Remediation</h4>
          ${renderRichTextBlock(payload.remediation)}

          <h4>Taxonomy Mapping</h4>
          ${taxonomyTable}

          <h4>Evidence Snippet</h4>
          <p><strong>File:</strong> ${renderPlainCell(evidence.filePath)}</p>
          <pre>${escapeHtml(String(evidence.snippet ?? ""))}</pre>

          <h4>Preconditions</h4>
          ${renderList(preconditions, "No explicit preconditions.")}
          <h4>Verification Plan</h4>
          ${renderList(verificationPlan, "No verification plan supplied.")}
          <h4>References</h4>
          ${referencesList}
        </section>
      `;
    })
    .join("\n");

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
      --line: #dbe3ec;
      --line-strong: #c8d4e2;
      --bg-soft: #f8fafc;
      --bg-soft-strong: #eef3f8;
      --bg-panel: #f5f8fc;
      --radius-sm: 6px;
      --radius-md: 10px;
    }
    @page { size: A4; margin: 18mm 14mm 18mm 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", "Calibri", Arial, sans-serif;
      color: var(--text);
      font-size: 11.5px;
      line-height: 1.55;
      background: white;
    }
    h1, h2, h3, h4 { margin: 0; }
    h1 { font-size: 27px; line-height: 1.15; letter-spacing: 0.01em; }
    h2 {
      margin-bottom: 8px;
      color: var(--brand-primary);
      font-size: 17px;
      line-height: 1.25;
    }
    h3 { font-size: 14px; line-height: 1.35; }
    h4 {
      margin: 11px 0 6px;
      color: var(--brand-primary);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    p { margin: 0 0 8px; }
    .section {
      margin-top: 16px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: white;
      page-break-inside: auto;
    }
    .section > :first-child { margin-top: 0; }
    .section > :last-child { margin-bottom: 0; }
    .page-break-before { page-break-before: always; }
    .muted { color: var(--muted); }
    .logo {
      width: 74px;
      height: 74px;
      object-fit: contain;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: white;
      padding: 8px;
    }
    .logo-fallback {
      width: 74px;
      height: 74px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      display: grid;
      place-items: center;
      background: linear-gradient(160deg, var(--bg-soft), #ffffff);
      color: var(--brand-primary);
      font-size: 28px;
      font-weight: 700;
    }
    .cover {
      min-height: 245mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 0;
      page-break-after: always;
      border: none;
      background: transparent;
    }
    .cover-top {
      display: grid;
      grid-template-columns: 80px 1fr;
      gap: 14px;
      align-items: center;
      border-bottom: 2px solid var(--brand-primary);
      padding-bottom: 16px;
      margin-bottom: 18px;
    }
    .cover-title p {
      margin: 6px 0 0;
      color: var(--muted);
    }
    .meta-table, .matrix, .toc-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: white;
      margin-top: 8px;
      overflow: hidden;
    }
    .meta-table th, .meta-table td,
    .matrix th, .matrix td,
    .toc-table th, .toc-table td {
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--line);
      border-right: 1px solid var(--line);
    }
    .meta-table tr:last-child td, .meta-table tr:last-child th,
    .matrix tr:last-child td, .matrix tr:last-child th,
    .toc-table tr:last-child td, .toc-table tr:last-child th {
      border-bottom: none;
    }
    .meta-table th:last-child, .meta-table td:last-child,
    .matrix th:last-child, .matrix td:last-child,
    .toc-table th:last-child, .toc-table td:last-child {
      border-right: none;
    }
    .meta-table th, .matrix thead th, .toc-table thead th {
      background: var(--bg-soft);
      font-weight: 600;
      color: #0f172a;
    }
    .meta-table th { width: 18%; white-space: nowrap; }
    .matrix-compact th, .matrix-compact td { padding: 7px 8px; font-size: 11px; }
    .finding-meta th { width: 20%; white-space: nowrap; }
    .toc-col-index {
      width: 72px;
      text-align: center;
      color: var(--brand-primary);
      font-weight: 700;
    }
    .toc-col-anchor {
      width: 120px;
      text-align: right;
      color: var(--muted);
      font-family: Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 10px;
      white-space: nowrap;
    }
    .toc-link {
      display: block;
      text-decoration: none;
      color: #0b1324;
      font-weight: 500;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 9px;
      margin: 10px 0;
    }
    .kpi {
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: linear-gradient(180deg, #ffffff, var(--bg-panel));
      padding: 10px;
    }
    .kpi span { display: block; color: var(--muted); font-size: 11px; }
    .kpi strong { font-size: 18px; line-height: 1.2; }
    .finding {
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-md);
      padding: 12px 12px 10px;
      margin-bottom: 12px;
      page-break-inside: avoid;
      background: linear-gradient(180deg, #ffffff, #fbfdff);
    }
    .finding-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      margin-bottom: 10px;
    }
    .badge {
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 10px;
      line-height: 1.3;
      text-transform: uppercase;
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .sev-critical { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
    .sev-high { background: #ffedd5; color: #9a3412; border-color: #fed7aa; }
    .sev-medium { background: #fef9c3; color: #854d0e; border-color: #fde68a; }
    .sev-low { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
    .sev-info { background: #e0f2fe; color: #0c4a6e; border-color: #bae6fd; }
    .pill {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      background: var(--bg-soft);
      border-radius: 999px;
      padding: 2px 8px;
      margin: 2px 4px 2px 0;
      font-size: 10px;
      line-height: 1.3;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    pre {
      background: #0b1220;
      color: #dbe4f0;
      border: 1px solid #1f2937;
      border-radius: var(--radius-sm);
      padding: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 10px;
      line-height: 1.45;
      margin: 8px 0 0;
    }
    code {
      font-family: Consolas, "Liberation Mono", Menlo, monospace;
      background: var(--bg-soft-strong);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 0 4px;
      font-size: 10px;
    }
    .list { margin: 0; padding-left: 18px; }
    .list li { margin-bottom: 4px; }
    .references li { overflow-wrap: anywhere; }
    .signoff {
      margin-top: 14px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 11px;
    }
    .report-footer {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      text-align: center;
      font-size: 10px;
      color: var(--muted);
    }
    a { color: var(--brand-primary); text-decoration: none; }
  </style>
</head>
<body>
  <section class="cover" id="cover">
    <div>
      <div class="cover-top">
        ${
          logoUrl
            ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Issuer logo" />`
            : `<div class="logo-fallback">${escapeHtml((params.branding.issuerName[0] ?? "T").toUpperCase())}</div>`
        }
        <div class="cover-title">
          <h1>${escapeHtml(params.branding.reportTitle)}</h1>
          <p>${escapeHtml(params.branding.issuerName)}</p>
        </div>
      </div>
      <table class="meta-table">
        <tbody>
          <tr>
            <th>Audit ID</th>
            <td>${escapeHtml(report.auditId)}</td>
            <th>Generated</th>
            <td>${escapeHtml(generatedAt)}</td>
          </tr>
          <tr>
            <th>Project ID</th>
            <td>${escapeHtml(report.projectId)}</td>
            <th>Revision ID</th>
            <td>${escapeHtml(report.revisionId)}</td>
          </tr>
          <tr>
            <th>Profile</th>
            <td>${escapeHtml(report.profile.toUpperCase())}</td>
            <th>Schema</th>
            <td>v${escapeHtml(String(report.reportSchemaVersion ?? report.schemaVersion ?? 2))}</td>
          </tr>
          <tr>
            <th>Engine</th>
            <td>${escapeHtml(report.engineVersion)}</td>
            <th>Export</th>
            <td>Final Complete Audit PDF</td>
          </tr>
        </tbody>
      </table>
      <div class="section">
        <h2>Confidentiality Statement</h2>
        ${renderRichTextBlock(params.branding.confidentialityNotice)}
        ${renderRichTextBlock(params.branding.legalDisclaimer)}
      </div>
    </div>
    <div class="muted">Prepared by ${escapeHtml(params.branding.issuerName)}</div>
  </section>

  <section class="section page-break-before">
    <h2>Table of Contents</h2>
    <table class="toc-table">
      <thead>
        <tr>
          <th class="toc-col-index">Section</th>
          <th>Title</th>
          <th class="toc-col-anchor">Anchor</th>
        </tr>
      </thead>
      <tbody>
        ${tocEntries
          .map(
            (entry) => `
              <tr>
                <td class="toc-col-index">${escapeHtml(entry.index)}</td>
                <td><a class="toc-link" href="#${escapeHtml(entry.target)}">${escapeHtml(entry.title)}</a></td>
                <td class="toc-col-anchor">#${escapeHtml(entry.target)}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  </section>

  <section class="section page-break-before" id="engagement">
    <h2>Engagement Metadata and Scope</h2>
    <table class="matrix">
      <tbody>
        <tr>
          <th>AI/LLM Model Used</th>
          <td>${escapeHtml(usedModel)}</td>
          <th>Primary Model</th>
          <td>${escapeHtml(primaryModel)}</td>
        </tr>
        <tr>
          <th>Fallback Model</th>
          <td>${escapeHtml(fallbackModel)}</td>
          <th>Standards</th>
          <td>${report.methodology.standards.length ? report.methodology.standards.map((item) => escapeHtml(item)).join(", ") : '<span class="muted">n/a</span>'}</td>
        </tr>
        <tr>
          <th>Scope</th>
          <td colspan="3">${renderTagList(report.methodology.scope, "No scope entries")}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="section" id="risk-posture">
    <h2>Executive Risk Posture</h2>
    ${renderRichTextBlock(report.executiveSummary.overview)}
    <div class="kpi-grid">
      <div class="kpi"><span>Critical</span><strong>${report.riskPosture.severityTotals.critical ?? 0}</strong></div>
      <div class="kpi"><span>High</span><strong>${report.riskPosture.severityTotals.high ?? 0}</strong></div>
      <div class="kpi"><span>Medium</span><strong>${report.riskPosture.severityTotals.medium ?? 0}</strong></div>
      <div class="kpi"><span>Low/Info</span><strong>${(report.riskPosture.severityTotals.low ?? 0) + (report.riskPosture.severityTotals.informational ?? 0)}</strong></div>
    </div>
    <table class="matrix matrix-compact">
      <tbody>
        <tr>
          <th>Overall Risk</th>
          <td>${escapeHtml(report.executiveSummary.overallRisk.toUpperCase())}</td>
          <th>CVSS Average</th>
          <td>${report.riskPosture.cvssAverage ?? "n/a"}</td>
          <th>CVSS Maximum</th>
          <td>${report.riskPosture.maxCvssScore ?? "n/a"}</td>
        </tr>
      </tbody>
    </table>
    <h4>Key Risks</h4>
    ${renderList(report.executiveSummary.keyRisks, "No key risks listed.")}
    <h4>Top Recommendations</h4>
    ${renderList(report.executiveSummary.topRecommendations, "No recommendations listed.")}
  </section>

  <section class="section page-break-before" id="methodology">
    <h2>Methodology and Verification Matrix</h2>
    ${renderRichTextBlock(report.methodology.approach)}
    <table class="matrix matrix-compact">
      <tbody>
        <tr>
          <th>Assumptions</th>
          <td>${report.methodology.assumptions.length ? report.methodology.assumptions.map((value) => renderInlineMarkdown(value)).join("<br />") : '<span class="muted">None</span>'}</td>
        </tr>
        <tr>
          <th>Limitations</th>
          <td>${report.methodology.limitations.length ? report.methodology.limitations.map((value) => renderInlineMarkdown(value)).join("<br />") : '<span class="muted">None</span>'}</td>
        </tr>
      </tbody>
    </table>
    ${renderVerificationMatrix(report)}
  </section>

  <section class="section" id="taxonomy">
    <h2>Taxonomy and Quality Gates</h2>
    <table class="matrix matrix-compact">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>OWASP mappings</td>
          <td>${report.taxonomySummary.owaspCount}</td>
          <td>CWE mappings</td>
          <td>${report.taxonomySummary.cweCount}</td>
        </tr>
        <tr>
          <td>SWC mappings</td>
          <td>${report.taxonomySummary.swcCount}</td>
          <td>Quality Gates</td>
          <td>${report.qualityGates.passed ? "Passed" : "Failed"}</td>
        </tr>
        <tr>
          <td>Taxonomy coverage</td>
          <td>${report.qualityGates.taxonomyCoveragePct.toFixed(2)}%</td>
          <td>CVSS coverage</td>
          <td>${report.qualityGates.cvssCoveragePct.toFixed(2)}%</td>
        </tr>
      </tbody>
    </table>
    <h4>Quality Gate Failures</h4>
    ${renderList(
      report.qualityGates.failures,
      report.qualityGates.passed ? "No failures." : "No failure details supplied."
    )}
  </section>

  <section class="section" id="differential">
    <h2>Differential Analysis</h2>
    ${renderTransitionSummary(params.transitions)}
  </section>

  <section class="section page-break-before" id="detailed-findings">
    <h2>Detailed Findings</h2>
    ${findingSections}
  </section>

  <section class="section page-break-before" id="appendix">
    <h2>Technical Appendix</h2>
    <h4>Verification Notes</h4>
    ${renderList(report.appendix.verificationNotes, "No verification notes provided.")}
    <h4>Internal Notes</h4>
    ${renderList(report.appendix.internalNotes, "No internal notes provided.")}
    <h4>Source References</h4>
    ${renderList(report.appendix.references, "No appendix references provided.")}
    <h4>Model Trace Summary</h4>
    <table class="matrix matrix-compact">
      <tbody>
        <tr>
          <th>Total Steps</th>
          <td>${report.modelTraceSummary.steps}</td>
          <th>Tool Calls</th>
          <td>${report.modelTraceSummary.totalToolCalls}</td>
        </tr>
        <tr>
          <th>Total Tokens</th>
          <td>${report.modelTraceSummary.totalTokens}</td>
          <th>Fallback Used</th>
          <td>${report.modelTraceSummary.usedFallback ? "Yes" : "No"}</td>
        </tr>
      </tbody>
    </table>
    <div class="signoff">
      <div>
        <div class="muted">${escapeHtml(params.branding.signatureLabel)}</div>
        <div><strong>${escapeHtml(params.branding.signerName)}</strong></div>
      </div>
      <div class="muted">Generated ${escapeHtml(generatedAt)}</div>
    </div>
  </section>
  <footer class="report-footer">audit.circulo.cloud</footer>
</body>
</html>`;
}

export function createPdfProcessor() {
  return async function pdf(job: Job<JobPayloadMap["pdf"]>) {
    const variant = FINAL_PDF_VARIANT;

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
      const generatedAtLabel = formatDateLabel(report.generatedAt);

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="font-size:8px;width:100%;padding:0 14mm;color:#475569;display:flex;justify-content:space-between;align-items:center;">
            <span>${escapeHtml(report.auditId)} · FINAL AUDIT REPORT</span>
            <span>${escapeHtml(generatedAtLabel)}</span>
          </div>
        `,
        footerTemplate:
          `
            <div style="font-size:8px;width:100%;padding:0 14mm;color:#475569;display:flex;justify-content:space-between;align-items:center;">
              <span>audit.circulo.cloud</span>
              <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
            </div>
          `,
        margin: {
          top: "18mm",
          right: "14mm",
          bottom: "18mm",
          left: "14mm"
        }
      });

      const s3Key = `pdf/${auditRun.id}/final/${Date.now()}.pdf`;
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
