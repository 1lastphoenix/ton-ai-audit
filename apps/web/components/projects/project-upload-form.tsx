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
};

export function ProjectUploadForm({ projectId, onUploaded }: ProjectUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/80 p-4">
      <div className="mb-2 text-sm font-medium text-zinc-200">Upload source or Blueprint ZIP</div>
      <p className="mb-3 text-xs text-zinc-400">
        Upload one file or one zip per revision. ZIP is recommended for multi-file projects.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          accept=".zip,.tolk,.fc,.func,.tact,.fift,.fif,.tlb,.ts,.js,.json,.md"
        />
        <Button
          disabled={!file || isUploading}
          onClick={async () => {
            if (!file) {
              return;
            }

            setError(null);
            setIsUploading(true);
            try {
              const isZip = file.name.toLowerCase().endsWith(".zip");

              const initResponse = await fetch(`/api/projects/${projectId}/uploads/init`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  filename: file.name,
                  contentType: file.type || "application/octet-stream",
                  sizeBytes: file.size,
                  type: isZip ? "zip" : "file-set",
                  parts: 1
                })
              });

              if (!initResponse.ok) {
                const payload = (await initResponse.json()) as { error?: string };
                throw new Error(payload.error ?? "Upload init failed");
              }

              const initPayload = (await initResponse.json()) as UploadInitResponse;
              if (!initPayload.singleUrl) {
                throw new Error("Multipart upload not supported by this form");
              }

              const uploadResponse = await fetch(initPayload.singleUrl, {
                method: "PUT",
                body: file,
                headers: {
                  "Content-Type": file.type || "application/octet-stream"
                }
              });

              if (!uploadResponse.ok) {
                throw new Error(`Upload failed with status ${uploadResponse.status}`);
              }

              const completeResponse = await fetch(`/api/projects/${projectId}/uploads/complete`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  uploadId: initPayload.uploadId,
                  eTags: []
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
              setFile(null);
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
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
