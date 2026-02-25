"use client";

import { useMemo, useState } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type SortMode = "newest" | "oldest" | "name";
type ActivityFilter = "all" | "recent" | "stale";

const dayMs = 24 * 60 * 60 * 1_000;
const recentWindowDays = 14;
const staleWindowDays = 45;

function toEpoch(value: string | Date) {
  return new Date(value).getTime();
}

function matchesActivityFilter(project: DashboardProject, filter: ActivityFilter) {
  if (filter === "all") {
    return true;
  }

  const ageDays = (Date.now() - toEpoch(project.updatedAt ?? project.createdAt)) / dayMs;
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

  const filterCounts = useMemo(() => {
    const recent = projects.filter((project) => matchesActivityFilter(project, "recent")).length;
    const stale = projects.filter((project) => matchesActivityFilter(project, "stale")).length;

    return {
      all: projects.length,
      recent,
      stale
    };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();

    return projects
      .filter((project) => {
        if (!matchesActivityFilter(project, activityFilter)) {
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
  }, [activityFilter, projects, query, sortMode]);

  return (
    <section className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 rounded-3xl border border-border/70 bg-card/75 p-4 shadow-sm backdrop-blur sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-xl">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects by name or slug"
            className="h-9 pl-9"
            aria-label="Search projects"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
            <SelectTrigger className="h-9 min-w-44">
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={activityFilter === "all" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setActivityFilter("all")}
        >
          All ({filterCounts.all})
        </Button>
        <Button
          type="button"
          variant={activityFilter === "recent" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setActivityFilter("recent")}
        >
          <CalendarClock className="size-3.5" />
          Active {recentWindowDays}d ({filterCounts.recent})
        </Button>
        <Button
          type="button"
          variant={activityFilter === "stale" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setActivityFilter("stale")}
        >
          <ArrowDownAZ className="size-3.5" />
          Quiet {staleWindowDays}d+ ({filterCounts.stale})
        </Button>

        {(query || activityFilter !== "all") && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
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

      <div className="text-muted-foreground mt-3 text-xs">
        {filteredProjects.length} result{filteredProjects.length === 1 ? "" : "s"} shown
      </div>

      <div className="mt-4">
        {projects.length === 0 ? (
          <div className="bg-background/60 rounded-2xl border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No ready projects yet.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Create your first project to start auditing smart contracts.
            </p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="bg-background/60 rounded-2xl border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No projects match the current filters.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Try a different query or reset filters.
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
