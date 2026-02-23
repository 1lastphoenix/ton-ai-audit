"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

export function ProjectCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = useMemo(() => slugInput || slugify(name), [name, slugInput]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          slug
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to create project");
      }

      const payload = (await response.json()) as { project: { id: string } };
      router.push(`/projects/${payload.project.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-lg border border-white/10 bg-white/5 p-4" onSubmit={onSubmit}>
      <div className="text-sm font-medium">Create project</div>
      <Input
        required
        placeholder="Project name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        required
        pattern="^[a-z0-9-]+$"
        placeholder="project-slug"
        value={slug}
        onChange={(event) => setSlugInput(event.target.value)}
      />
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <Button type="submit" disabled={isSubmitting || !name || !slug}>
        {isSubmitting ? "Creating..." : "Create"}
      </Button>
    </form>
  );
}
