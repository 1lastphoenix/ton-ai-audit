"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ArrowDownAZ, CalendarClock, LayoutGrid, List, Search } from "lucide-react";

import { type DashboardProject, ProjectCard } from "@/components/dashboard/project-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type SortMode = "newest" | "oldest" | "name";
type ActivityFilter = "all" | "recent" | "stale";

const dayMs = 24 * 60 * 60 * 1_000;
const recentWindowDays = 14;
const staleWindowDays = 45;

function toEpoch(value: string | Date) {
  return new Date(value).getTime();
}

function latestProjectUpdate(project: DashboardProject) {
  return toEpoch(project.updatedAt ?? project.createdAt);
}

function matchesActivityFilter(
  project: DashboardProject,
  filter: ActivityFilter,
  latestUpdateTimestamp: number | null
) {
  if (filter === "all") {
    return true;
  }
  if (latestUpdateTimestamp === null) {
    return false;
  }

  const ageDays = (latestUpdateTimestamp - latestProjectUpdate(project)) / dayMs;
  if (filter === "recent") {
    return ageDays <= recentWindowDays;
  }

  return ageDays > staleWindowDays;
}

export function ProjectList({ projects }: { projects: DashboardProject[] }) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const deferredQuery = useDeferredValue(query);
  const isFiltering = query !== deferredQuery;
  const latestUpdateTimestamp = useMemo(
    () =>
      projects.length === 0
        ? null
        : projects.reduce((latest, project) => Math.max(latest, latestProjectUpdate(project)), 0),
    [projects]
  );

  const filterCounts = useMemo(() => {
    const recent = projects.filter((project) =>
      matchesActivityFilter(project, "recent", latestUpdateTimestamp)
    ).length;
    const stale = projects.filter((project) =>
      matchesActivityFilter(project, "stale", latestUpdateTimestamp)
    ).length;

    return {
      all: projects.length,
      recent,
      stale
    };
  }, [latestUpdateTimestamp, projects]);

  const filteredProjects = useMemo(() => {
    const loweredQuery = deferredQuery.trim().toLowerCase();

    return projects
      .filter((project) => {
        if (!matchesActivityFilter(project, activityFilter, latestUpdateTimestamp)) {
          return false;
        }

        if (!loweredQuery) {
          return true;
        }

        return (
          project.name.toLowerCase().includes(loweredQuery) ||
          project.slug.toLowerCase().includes(loweredQuery)
        );
      })
      .sort((left, right) => {
        if (sortMode === "name") {
          return left.name.localeCompare(right.name);
        }

        const leftCreatedAt = toEpoch(left.createdAt);
        const rightCreatedAt = toEpoch(right.createdAt);

        if (sortMode === "oldest") {
          return leftCreatedAt - rightCreatedAt;
        }

        return rightCreatedAt - leftCreatedAt;
      });
  }, [activityFilter, deferredQuery, latestUpdateTimestamp, projects, sortMode]);

  return (
    <section className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 rounded-2xl border border-border/70 bg-card/75 p-3 shadow-sm backdrop-blur sm:rounded-3xl sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-xl">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects by name or slug"
            className="h-8 pl-8.5 text-sm sm:h-9 sm:pl-9"
            aria-label="Search projects"
          />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
            <SelectTrigger className="h-8 min-w-0 flex-1 sm:h-9 sm:min-w-44">
              <SelectValue placeholder="Sort projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
            </SelectContent>
          </Select>

          <ToggleGroup
            type="single"
            value={viewMode}
            variant="outline"
            size="sm"
            onValueChange={(value) => {
              if (value === "grid" || value === "list") {
                setViewMode(value);
              }
            }}
            aria-label="Project view mode"
            className="ml-auto"
          >
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:mt-4 sm:gap-2">
        <Button
          type="button"
          variant={activityFilter === "all" ? "secondary" : "outline"}
          size="xs"
          onClick={() => setActivityFilter("all")}
        >
          All ({filterCounts.all})
        </Button>
        <Button
          type="button"
          variant={activityFilter === "recent" ? "secondary" : "outline"}
          size="xs"
          onClick={() => setActivityFilter("recent")}
        >
          <CalendarClock className="size-3.5" />
          Active {recentWindowDays}d ({filterCounts.recent})
        </Button>
        <Button
          type="button"
          variant={activityFilter === "stale" ? "secondary" : "outline"}
          size="xs"
          onClick={() => setActivityFilter("stale")}
        >
          <ArrowDownAZ className="size-3.5" />
          Quiet {staleWindowDays}d+ ({filterCounts.stale})
        </Button>

        {(query || activityFilter !== "all") && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => {
              setQuery("");
              setActivityFilter("all");
            }}
          >
            Reset filters
          </Button>
        )}
      </div>

      <div className="text-muted-foreground mt-2 text-xs sm:mt-3">
        {isFiltering ? "Filtering..." : null}
        {isFiltering ? " " : null}
        {filteredProjects.length} result{filteredProjects.length === 1 ? "" : "s"} shown
      </div>

      <div className="mt-3 sm:mt-4">
        {projects.length === 0 ? (
          <div className="bg-background/60 rounded-2xl border border-dashed p-6 text-center sm:p-10">
            <p className="text-sm font-medium">No ready projects yet.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Create your first project to start auditing smart contracts.
            </p>
          </div>
        ) : isFiltering ? (
          <ProjectListSkeleton viewMode={viewMode} />
        ) : filteredProjects.length === 0 ? (
          <div className="bg-background/60 rounded-2xl border border-dashed p-6 text-center sm:p-10">
            <p className="text-sm font-medium">No projects match the current filters.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Try a different query or reset filters.
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} variant="grid" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} variant="list" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectListSkeleton({ viewMode }: { viewMode: "grid" | "list" }) {
  if (viewMode === "list") {
    return (
      <div className="grid gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={`list-skeleton-${index}`}
            className="bg-background/60 rounded-2xl border border-border/60 p-3.5 sm:p-4"
          >
            <div className="grid gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={`grid-skeleton-${index}`}
          className="bg-background/60 rounded-2xl border border-border/60 p-3.5 sm:p-4"
        >
          <div className="grid gap-2.5">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <div className="mt-1 flex items-center gap-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
