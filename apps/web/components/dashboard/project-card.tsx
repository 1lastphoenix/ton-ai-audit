"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ExternalLink, Timer, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const dayMs = 24 * 60 * 60 * 1_000;

export type DashboardProject = {
  id: string;
  name: string;
  slug: string;
  createdAt: string | Date;
  updatedAt?: string | Date;
  lifecycleState: string;
};

type ProjectCardProps = {
  project: DashboardProject;
  variant?: "grid" | "list";
};

function toEpoch(value: string | Date) {
  return new Date(value).getTime();
}

function formatCalendarDate(value: string | Date) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function shortProjectId(projectId: string) {
  if (projectId.length <= 12) {
    return projectId;
  }

  return `${projectId.slice(0, 8)}..${projectId.slice(-4)}`;
}

export function ProjectCard({ project, variant = "grid" }: ProjectCardProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setError(null);
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to delete project");
      }
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete project");
    } finally {
      setIsDeleting(false);
    }
  }

  const createdAtLabel = formatCalendarDate(project.createdAt);
  const updatedAtTimestamp = toEpoch(project.updatedAt ?? project.createdAt);
  const updatedAtLabel = formatCalendarDate(project.updatedAt ?? project.createdAt);
  const isFreshProject = updatedAtTimestamp - toEpoch(project.createdAt) <= dayMs;

  const deleteAction = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={isDeleting}>
          <Trash2 className="size-3.5" />
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project?</AlertDialogTitle>
          <AlertDialogDescription>
            This project will be hidden from the dashboard and its workspace will no longer be accessible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={isDeleting} onClick={onDelete}>
            Confirm Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (variant === "list") {
    return (
      <Card className="bg-card/80 border-border/70 py-0 transition-all hover:-translate-y-0.5 hover:shadow-sm">
        <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="line-clamp-1 text-base font-medium">{project.name}</h3>
              <Badge variant="outline" className="capitalize">
                {project.lifecycleState}
              </Badge>
              {isFreshProject ? <Badge variant="secondary">Fresh</Badge> : null}
            </div>

            <p className="text-muted-foreground font-mono text-xs">{project.slug}</p>

            <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5" />
                {createdAtLabel}
              </span>
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3.5" />
                Updated {updatedAtLabel}
              </span>
              <span className="font-mono">ID {shortProjectId(project.id)}</span>
            </div>

            {error ? <p className="text-destructive text-xs">{error}</p> : null}
          </div>

          <div className="flex shrink-0 items-center gap-2 self-start md:self-center">
            <Button asChild size="sm" className="gap-1.5">
              <Link href={`/projects/${project.id}`}>
                Open
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
            {deleteAction}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-card/80 border-border/70 group relative transition-all hover:-translate-y-1 hover:shadow-md">
      <div className="pointer-events-none absolute inset-x-5 top-0 h-20 bg-gradient-to-r from-sky-500/20 via-cyan-500/5 to-amber-500/20 opacity-70 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />

      <CardHeader className="relative gap-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-2 text-base">{project.name}</CardTitle>
          <Badge variant="outline" className="capitalize">
            {project.lifecycleState}
          </Badge>
        </div>
        <p className="text-muted-foreground font-mono text-xs">{project.slug}</p>
        <div className="flex flex-wrap gap-2">
          {isFreshProject ? <Badge variant="secondary">Fresh</Badge> : null}
          <Badge variant="ghost">Updated {updatedAtLabel}</Badge>
        </div>
      </CardHeader>

      <CardContent className="relative">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CalendarClock className="size-3.5" />
          Created {createdAtLabel}
        </p>
        <p className="text-muted-foreground mt-1 font-mono text-xs">ID {shortProjectId(project.id)}</p>
        {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2">
        <Button asChild size="sm" className="gap-1.5">
          <Link href={`/projects/${project.id}`}>
            Open
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>

        {deleteAction}
      </CardFooter>
    </Card>
  );
}
