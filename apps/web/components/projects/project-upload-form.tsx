"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProjectUploadFormProps = {
  projectId: string;
  onUploaded: (payload: { revisionId: string; jobId: string | null }) => void;
};

type UploadInitResponse = {
  uploadId: string;
  singleUrl: string | null;
  partUrls: Array<{ partNumber: number; url: string }>;
  fileUrls?: Array<{ path: string; key: string; url: string }>;
};

export function ProjectUploadForm({ projectId, onUploaded }: ProjectUploadFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="mb-2 text-sm font-medium">Upload source or Blueprint ZIP</div>
      <p className="text-muted-foreground mb-3 text-xs">
        Upload one file or one zip per revision. ZIP is recommended for multi-file projects.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="file"
          multiple
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          accept=".zip,.tolk,.fc,.func,.tact,.fift,.fif,.tlb,.ts,.js,.json,.md"
        />
        <Button
          disabled={files.length === 0 || isUploading}
          onClick={async () => {
            if (files.length === 0) {
              return;
            }

            setError(null);
            setIsUploading(true);
            try {
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

              const initResponse = await fetch(`/api/projects/${projectId}/uploads/init`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify(requestBody)
              });

              if (!initResponse.ok) {
                const payload = (await initResponse.json()) as { error?: string };
                throw new Error(payload.error ?? "Upload init failed");
              }

              const initPayload = (await initResponse.json()) as UploadInitResponse;
              const completedFiles: Array<{ path: string }> = [];

              if (isZip) {
                if (!initPayload.singleUrl) {
                  throw new Error("Multipart upload not supported by this form");
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
                  throw new Error("File-set upload URLs were not returned");
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

              const revisionResponse = await fetch(
                `/api/projects/${projectId}/revisions/from-upload`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    uploadId: initPayload.uploadId
                  })
                }
              );

              if (!revisionResponse.ok) {
                const payload = (await revisionResponse.json()) as { error?: string };
                throw new Error(payload.error ?? "Failed to create revision");
              }

              const revisionPayload = (await revisionResponse.json()) as {
                revision: { id: string };
                jobId: string | null;
              };

              onUploaded({
                revisionId: revisionPayload.revision.id,
                jobId: revisionPayload.jobId
              });
              setFiles([]);
            } catch (uploadError) {
              setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
            } finally {
              setIsUploading(false);
            }
          }}
        >
          {isUploading ? "Uploading..." : "Upload"}
        </Button>
      </div>
      {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
    </div>
  );
}
