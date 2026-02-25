"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AuditHistoryListItemBase = {
  id: string;
  revisionId: string;
  createdAt: string;
  status: string;
  profile: "fast" | "deep";
  findingCount: number;
  primaryModelId: string;
};

type WorkbenchAuditHistoryListProps<TItem extends AuditHistoryListItemBase> = {
  items: TItem[];
  selectedAuditId: string | null;
  isBusy: boolean;
  shortId: (value: string | null, size?: number) => string;
  toAuditStatusLabel: (status: string) => string;
  auditStatusBadgeClass: (status: string) => string;
  toPdfStatusLabel: (status: string) => string;
  pdfStatusBadgeClass: (status: string) => string;
  toProfileLabel: (profile: "fast" | "deep") => string;
  getPdfStatus: (item: TItem) => string;
  canExportPdf: (auditStatus?: string | null, pdfStatus?: string | null) => boolean;
  onViewAudit: (item: TItem) => void;
  onExportPdf: (auditId: string) => void;
};

export function WorkbenchAuditHistoryList<TItem extends AuditHistoryListItemBase>(
  props: WorkbenchAuditHistoryListProps<TItem>,
) {
  if (!props.items.length) {
    return (
      <div className="text-muted-foreground text-xs">
        No audits yet for this project.
      </div>
    );
  }

  return (
    <div className="space-y-2 [content-visibility:auto]">
      {props.items.map((item) => {
        const pdfStatus = props.getPdfStatus(item);
        return (
          <div
            key={item.id}
            className={cn(
              "bg-card rounded-md border border-border px-2.5 py-2",
              item.id === props.selectedAuditId ? "border-primary/50 shadow-sm" : "",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-foreground truncate text-xs font-medium">
                  audit {props.shortId(item.id)} · rev {props.shortId(item.revisionId)}
                </div>
                <div className="text-muted-foreground text-[11px]">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 border px-1.5 text-[10px] font-medium",
                    props.auditStatusBadgeClass(item.status),
                  )}
                >
                  {props.toAuditStatusLabel(item.status)}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 border px-1.5 text-[10px] font-medium",
                    props.pdfStatusBadgeClass(pdfStatus),
                  )}
                >
                  PDF {props.toPdfStatusLabel(pdfStatus)}
                </Badge>
              </div>
            </div>
            <div className="text-muted-foreground mt-1.5 text-[11px]">
              findings {item.findingCount} · {item.primaryModelId}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {props.toProfileLabel(item.profile ?? "deep")}
              </Badge>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {item.id !== props.selectedAuditId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => {
                    props.onViewAudit(item);
                  }}
                >
                  View
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={!props.canExportPdf(item.status, pdfStatus) || props.isBusy}
                onClick={() => {
                  props.onExportPdf(item.id);
                }}
              >
                Final PDF
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
