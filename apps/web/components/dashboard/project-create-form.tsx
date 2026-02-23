"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type UploadInitResponse = {
  uploadId: string;
  singleUrl: string | null;
  partUrls: Array<{ partNumber: number; url: string }>;
  fileUrls?: Array<{ path: string; key: string; url: string }>;
};

type CreateMode = "scaffold" | "upload";
type CreateStep = "details" | "upload";
type CreatePhase =
  | "idle"
  | "creating-project"
  | "requesting-urls"
  | "uploading-files"
  | "finalizing-upload"
  | "creating-revision"
  | "waiting-ingest";

const phaseLabels: Record<CreatePhase, string> = {
  idle: "",
  "creating-project": "Creating project...",
  "requesting-urls": "Requesting upload URLs...",
  "uploading-files": "Uploading files...",
  "finalizing-upload": "Finalizing upload...",
  "creating-revision": "Creating initial revision...",
  "waiting-ingest": "Waiting for ingest to finish..."
};

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
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<CreateStep>("details");
  const [mode, setMode] = useState<CreateMode>("scaffold");
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [cleanupOnClose, setCleanupOnClose] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<CreatePhase>("idle");
  const [name, setName] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = useMemo(() => slugInput || slugify(name), [name, slugInput]);

  const isUploadStep = step === "upload";

  function resetState() {
    setStep("details");
    setMode("scaffold");
    setCreatedProjectId(null);
    setCleanupOnClose(false);
    setFiles([]);
    setPhase("idle");
    setName("");
    setSlugInput("");
    setError(null);
    setIsSubmitting(false);
  }

  async function softDeleteProject(projectId: string) {
    await fetch(`/api/projects/${projectId}`, {
      method: "DELETE"
    }).catch(() => undefined);
  }

  async function waitForProjectReady(projectId: string) {
    const maxAttempts = 45;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const statusResponse = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (statusResponse.status === 404) {
        throw new Error("Initialization failed while ingesting source files.");
      }
      if (!statusResponse.ok) {
        continue;
      }

      const statusPayload = (await statusResponse.json()) as {
        project: { lifecycleState: string };
        latest: { latestRevision: { id: string } | null };
      };

      if (
        statusPayload.project.lifecycleState === "ready" &&
        statusPayload.latest.latestRevision?.id
      ) {
        return;
      }
    }

    throw new Error("Initialization is taking too long. Please retry project creation.");
  }

  async function uploadInitialFiles(projectId: string) {
    const selectedFiles = files;
    const zipFiles = selectedFiles.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    const isZip = selectedFiles.length === 1 && zipFiles.length === 1;

    if (!isZip && zipFiles.length > 0) {
      throw new Error("ZIP uploads cannot be combined with separate files.");
    }

    const totalSizeBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const requestBody = isZip
      ? {
          filename: selectedFiles[0]!.name,
          contentType: selectedFiles[0]!.type || "application/octet-stream",
          sizeBytes: selectedFiles[0]!.size,
          type: "zip" as const,
          parts: 1
        }
      : {
          type: "file-set" as const,
          files: selectedFiles.map((file) => ({
            path: file.webkitRelativePath || file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size
          })),
          totalSizeBytes
        };

    setPhase("requesting-urls");
    const initResponse = await fetch(`/api/projects/${projectId}/uploads/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    if (!initResponse.ok) {
      const payload = (await initResponse.json()) as { error?: string };
      throw new Error(payload.error ?? "Upload initialization failed");
    }

    const initPayload = (await initResponse.json()) as UploadInitResponse;
    const completedFiles: Array<{ path: string }> = [];

    setPhase("uploading-files");
    if (isZip) {
      if (!initPayload.singleUrl) {
        throw new Error("Multipart upload is not supported in this create flow.");
      }

      const zipFile = selectedFiles[0]!;
      const uploadResponse = await fetch(initPayload.singleUrl, {
        method: "PUT",
        body: zipFile,
        headers: {
          "Content-Type": zipFile.type || "application/octet-stream"
        }
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }
    } else {
      if (!initPayload.fileUrls?.length) {
        throw new Error("No upload URLs were returned for files.");
      }

      const uploadUrlByPath = new Map(initPayload.fileUrls.map((entry) => [entry.path, entry.url]));
      for (const selectedFile of selectedFiles) {
        const uploadPath = selectedFile.webkitRelativePath || selectedFile.name;
        const uploadUrl = uploadUrlByPath.get(uploadPath);
        if (!uploadUrl) {
          throw new Error(`Upload URL missing for ${uploadPath}`);
        }

        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          body: selectedFile,
          headers: {
            "Content-Type": selectedFile.type || "application/octet-stream"
          }
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status} (${uploadPath})`);
        }

        completedFiles.push({ path: uploadPath });
      }
    }

    setPhase("finalizing-upload");
    const completeResponse = await fetch(`/api/projects/${projectId}/uploads/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        uploadId: initPayload.uploadId,
        eTags: [],
        completedFiles
      })
    });
    if (!completeResponse.ok) {
      const payload = (await completeResponse.json()) as { error?: string };
      throw new Error(payload.error ?? "Upload completion failed");
    }

    setPhase("creating-revision");
    const revisionResponse = await fetch(`/api/projects/${projectId}/revisions/from-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        uploadId: initPayload.uploadId
      })
    });
    if (!revisionResponse.ok) {
      const payload = (await revisionResponse.json()) as { error?: string };
      throw new Error(payload.error ?? "Failed to create initial revision");
    }

    setPhase("waiting-ingest");
    await waitForProjectReady(projectId);
  }

  async function onDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    setPhase("creating-project");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          slug,
          initialization:
            mode === "scaffold"
              ? {
                  mode: "scaffold",
                  language: "tolk"
                }
              : {
                  mode: "upload"
                }
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to create project");
      }

      const payload = (await response.json()) as { project: { id: string } };

      if (mode === "scaffold") {
        setCleanupOnClose(false);
        setOpen(false);
        resetState();
        router.push(`/projects/${payload.project.id}`);
        router.refresh();
        return;
      }

      setCreatedProjectId(payload.project.id);
      setStep("upload");
      setCleanupOnClose(true);
      setPhase("idle");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unknown error");
      setPhase("idle");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onUploadSubmit() {
    if (!createdProjectId || files.length === 0) {
      setError("Select at least one source file or one ZIP archive.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await uploadInitialFiles(createdProjectId);
      setCleanupOnClose(false);
      setOpen(false);
      resetState();
      router.push(`/projects/${createdProjectId}`);
      router.refresh();
    } catch (uploadError) {
      await softDeleteProject(createdProjectId);
      setError(uploadError instanceof Error ? uploadError.message : "Project initialization failed");
      setStep("details");
      setCreatedProjectId(null);
      setFiles([]);
      setPhase("idle");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) {
          return;
        }
        if (!nextOpen && cleanupOnClose && createdProjectId && isUploadStep && !isSubmitting) {
          void softDeleteProject(createdProjectId);
        }
        if (!nextOpen) {
          resetState();
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg">Create project</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>Create TON audit project</DialogTitle>
          <DialogDescription>
            Choose an initialization mode so every project starts with a revision-ready workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={isUploadStep ? "outline" : "secondary"}>1. Details</Badge>
            <Badge variant={isUploadStep ? "secondary" : "outline"}>2. Initialization</Badge>
          </div>

          {isUploadStep ? (
            <div className="grid gap-3">
              <div className="text-sm font-medium">Upload smart contracts</div>
              <Input
                type="file"
                multiple
                accept=".zip,.tolk,.fc,.func,.tact,.fift,.fif,.tlb,.ts,.js,.json,.md"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
              <p className="text-xs text-muted-foreground">
                Choose either one ZIP archive or multiple source files.
              </p>
            </div>
          ) : (
            <form id="project-create-details-form" className="grid gap-4" onSubmit={onDetailsSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  required
                  placeholder="My TON Security Review"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-slug">Project slug</Label>
                <Input
                  id="project-slug"
                  required
                  pattern="^[a-z0-9-]+$"
                  placeholder="my-ton-security-review"
                  value={slug}
                  onChange={(event) => setSlugInput(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Initialization mode</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(value) => setMode(value as CreateMode)}
                  className="grid gap-2"
                >
                  <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                    <RadioGroupItem value="scaffold" className="mt-0.5" />
                    <div className="grid gap-1">
                      <span className="text-sm font-medium">Empty Blueprint Scaffold</span>
                      <span className="text-xs text-muted-foreground">
                        Start with a minimal Tolk scaffold: starter contract, tests, and README.
                      </span>
                    </div>
                  </Label>
                  <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                    <RadioGroupItem value="upload" className="mt-0.5" />
                    <div className="grid gap-1">
                      <span className="text-sm font-medium">Upload Smart Contracts</span>
                      <span className="text-xs text-muted-foreground">
                        Provide ZIP or source files now; project becomes visible after ingest succeeds.
                      </span>
                    </div>
                  </Label>
                </RadioGroup>
              </div>
            </form>
          )}

          {phase !== "idle" ? <p className="text-primary text-xs font-medium">{phaseLabels[phase]}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          {isUploadStep ? (
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={async () => {
                  if (createdProjectId) {
                    await softDeleteProject(createdProjectId);
                  }
                  setCleanupOnClose(false);
                  setOpen(false);
                  resetState();
                }}
              >
                Cancel
              </Button>
              <Button type="button" disabled={isSubmitting || files.length === 0} onClick={onUploadSubmit}>
                {isSubmitting ? "Initializing..." : "Initialize Project"}
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              form="project-create-details-form"
              disabled={isSubmitting || !name || !slug}
            >
              {isSubmitting ? "Creating..." : mode === "upload" ? "Continue to Upload" : "Create Project"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
