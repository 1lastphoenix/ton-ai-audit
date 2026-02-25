import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function WorkbenchTooltip(props: {
  content?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}) {
  if (!props.content) {
    return <>{props.children}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{props.children}</span>
      </TooltipTrigger>
      <TooltipContent side={props.side ?? "bottom"}>
        {props.content}
      </TooltipContent>
    </Tooltip>
  );
}

export function RailToggleButton(props: {
  active: boolean;
  icon: LucideIcon;
  ariaLabel: string;
  title?: string;
  onClick: () => void;
}) {
  const Icon = props.icon;

  return (
    <WorkbenchTooltip content={props.title}>
      <Button
        type="button"
        size="icon-sm"
        variant={props.active ? "default" : "ghost"}
        className={cn(
          props.active
            ? "bg-accent text-accent-foreground hover:bg-accent/80"
            : "text-muted-foreground",
        )}
        onClick={props.onClick}
        aria-label={props.ariaLabel}
      >
        <Icon className="size-4" />
      </Button>
    </WorkbenchTooltip>
  );
}
