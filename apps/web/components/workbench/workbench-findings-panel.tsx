"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type FindingTaxonomyTag = {
  standard: string;
  id: string;
};

type FindingCvss = {
  baseScore?: number;
};

type FindingPayload = {
  title?: string;
  severity?: string;
  summary?: string;
  remediation?: string;
  businessImpact?: string;
  technicalImpact?: string;
  confidence?: number;
  fixPriority?: string;
  taxonomy?: FindingTaxonomyTag[];
  cvssV31?: FindingCvss;
  evidence?: {
    filePath?: string;
    startLine?: number;
  };
};

type FindingItem = {
  id: string;
  severity?: string;
  payloadJson?: FindingPayload;
};

type FindingFilterOption = {
  id: string;
  label: string;
  count: number;
};

type WorkbenchFindingsPanelProps = {
  findingsQuery: string;
  findingsSeverityFilter: string;
  findingFilterOptions: FindingFilterOption[];
  findings: FindingItem[];
  filteredFindings: FindingItem[];
  onFindingsQueryChange: (value: string) => void;
  onFindingsSeverityFilterChange: (value: string) => void;
  onClearFindingsFilters: () => void;
  onRevealFinding: (item: FindingItem) => void;
  severityBadgeClass: (severity: string) => string;
  formatSeverityLabel: (severity: string) => string;
  lastError: string | null;
};

export function WorkbenchFindingsPanel(props: WorkbenchFindingsPanelProps) {
  return (
    <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-3 py-3">
      <div className="min-w-0 space-y-3 pb-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            value={props.findingsQuery}
            onChange={(event) => {
              props.onFindingsQueryChange(event.target.value);
            }}
            className="h-8 text-xs"
            placeholder="Search findings, summaries, or files"
          />
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <Select
            value={props.findingsSeverityFilter}
            onValueChange={props.onFindingsSeverityFilterChange}
          >
            <SelectTrigger className="h-8 w-full min-w-0 text-[11px]" aria-label="Filter findings">
              <SelectValue placeholder="Filter by severity" />
            </SelectTrigger>
            <SelectContent align="start" className="min-w-[12rem]">
              {props.findingFilterOptions.map((option) => (
                <SelectItem key={option.id} value={option.id} className="text-xs">
                  {option.label} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.findingsQuery || props.findingsSeverityFilter !== "all" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              onClick={props.onClearFindingsFilters}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {props.filteredFindings.length === 0 ? (
          <div className="bg-card text-muted-foreground rounded-md border border-border px-3 py-2 text-xs">
            {props.findings.length === 0
              ? "No findings on this audit revision."
              : "No findings match your current filters."}
          </div>
        ) : (
          <div className="space-y-2 [content-visibility:auto]">
            {props.filteredFindings.map((item) => {
              const severity = item.payloadJson?.severity ?? item.severity ?? "";
              const title = item.payloadJson?.title ?? "Untitled finding";
              const summary = item.payloadJson?.summary;
              const filePath = item.payloadJson?.evidence?.filePath;
              const line = item.payloadJson?.evidence?.startLine;
              const taxonomy = item.payloadJson?.taxonomy ?? [];
              const cvss = item.payloadJson?.cvssV31;
              const confidence =
                typeof item.payloadJson?.confidence === "number"
                  ? `${Math.round(item.payloadJson.confidence * 100)}%`
                  : null;
              const fixPriority = item.payloadJson?.fixPriority?.toUpperCase() ?? null;
              const remediation = item.payloadJson?.remediation;
              const businessImpact = item.payloadJson?.businessImpact;
              const technicalImpact = item.payloadJson?.technicalImpact;

              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  className="bg-card h-auto w-full min-w-0 justify-start whitespace-normal rounded-md border border-border p-2.5 text-left hover:bg-accent/35"
                  onClick={() => {
                    props.onRevealFinding(item);
                  }}
                >
                  <div className="w-full min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-5 border px-1.5 text-[10px] font-medium",
                          props.severityBadgeClass(severity),
                        )}
                      >
                        {props.formatSeverityLabel(severity)}
                      </Badge>
                      {filePath ? (
                        <span className="text-muted-foreground max-w-[65%] truncate text-[10px] leading-5">
                          {filePath}
                          {line ? `:${line}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-foreground mt-1.5 break-words text-xs font-medium leading-4">
                      {title}
                    </div>
                    {summary ? (
                      <div className="text-muted-foreground mt-1 line-clamp-2 break-words text-[11px] leading-4">
                        {summary}
                      </div>
                    ) : null}
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                      {cvss?.baseScore !== undefined ? (
                        <span className="rounded border border-border px-1.5 py-0.5">
                          CVSS {cvss.baseScore.toFixed(1)}
                        </span>
                      ) : null}
                      {confidence ? (
                        <span className="rounded border border-border px-1.5 py-0.5">
                          Confidence {confidence}
                        </span>
                      ) : null}
                      {fixPriority ? (
                        <span className="rounded border border-border px-1.5 py-0.5">
                          {fixPriority}
                        </span>
                      ) : null}
                    </div>
                    {taxonomy.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {taxonomy.slice(0, 4).map((tag) => (
                          <span
                            key={`${item.id}-${tag.standard}-${tag.id}`}
                            className="text-muted-foreground rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]"
                          >
                            {tag.standard.toUpperCase()} {tag.id}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {businessImpact || technicalImpact ? (
                      <div className="text-muted-foreground mt-1.5 line-clamp-2 text-[10px] leading-4">
                        {businessImpact ? `Business: ${businessImpact}` : ""}
                        {businessImpact && technicalImpact ? " | " : ""}
                        {technicalImpact ? `Technical: ${technicalImpact}` : ""}
                      </div>
                    ) : null}
                    {remediation ? (
                      <div className="text-muted-foreground mt-1.5 line-clamp-2 text-[10px] leading-4">
                        Fix: {remediation}
                      </div>
                    ) : null}
                  </div>
                </Button>
              );
            })}
          </div>
        )}

        {props.lastError ? <p className="text-destructive text-xs">{props.lastError}</p> : null}
      </div>
    </div>
  );
}
