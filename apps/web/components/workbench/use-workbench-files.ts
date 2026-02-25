"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { detectLanguageFromPath, normalizePath, type Language } from "@ton-audit/shared";

import { DEFAULT_NEW_FILE_NAME } from "@/components/workbench/ton-workbench.constants";
import { buildTreeFromPaths, getParentDirectories, treeFiles } from "@/components/workbench/ton-workbench.utils";
import type { TreeNode, WorkbenchFileEntry, WorkbenchLogLevel } from "@/components/workbench/ton-workbench.types";

type UseWorkbenchFilesParams = {
  projectId: string;
  initialRevisionId: string | null;
  initialWorkingCopyId: string | null;
  onError: (message: string) => void;
  onClearError: () => void;
  onActivity: (message: string) => void;
  onLog: (level: WorkbenchLogLevel, message: string) => void;
};

export function useWorkbenchFiles(params: UseWorkbenchFilesParams) {
  const {
    projectId,
    initialRevisionId,
    initialWorkingCopyId,
    onError,
    onClearError,
    onActivity,
    onLog,
  } = params;

  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [workingCopyId, setWorkingCopyId] = useState<string | null>(
    initialWorkingCopyId,
  );
  const [isEditable, setIsEditable] = useState(Boolean(initialWorkingCopyId));
  const [isBusy, setIsBusy] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
  const [fileCache, setFileCache] = useState<Record<string, WorkbenchFileEntry>>(
    {},
  );
  const [isInlineNewFile, setIsInlineNewFile] = useState(false);
  const [inlineNewFileName, setInlineNewFileName] = useState(
    DEFAULT_NEW_FILE_NAME,
  );
  const [inlineNewFileParentPath, setInlineNewFileParentPath] = useState<
    string | null
  >(null);

  const inlineNewFileRowRef = useRef<HTMLDivElement | null>(null);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileCacheRef = useRef<Record<string, WorkbenchFileEntry>>({});

  const allFiles = useMemo(() => treeFiles(tree), [tree]);

  useEffect(() => {
    fileCacheRef.current = fileCache;
  }, [fileCache]);

  const openFileInEditor = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenTabs((current) =>
      current.includes(path) ? current : [...current, path],
    );
    const parents = getParentDirectories(path);
    if (parents.length) {
      setExpandedDirectories((current) => [
        ...new Set([...current, ...parents]),
      ]);
    }
  }, []);

  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirectories((current) =>
      current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path],
    );
  }, []);

  const closeOpenTab = useCallback((path: string) => {
    setOpenTabs((current) => {
      const closedIndex = current.findIndex((entry) => entry === path);
      if (closedIndex < 0) {
        return current;
      }

      const next = current.filter((entry) => entry !== path);
      setSelectedPath((currentSelected) => {
        if (currentSelected !== path) {
          return currentSelected;
        }

        return next[closedIndex] ?? next[closedIndex - 1] ?? next[0] ?? null;
      });

      return next;
    });
  }, []);

  const loadTree = useCallback(
    async (targetRevisionId: string) => {
      const sourceUrl = workingCopyId
        ? `/api/projects/${projectId}/working-copies/${workingCopyId}/tree`
        : `/api/projects/${projectId}/revisions/${targetRevisionId}/tree`;
      const response = await fetch(sourceUrl, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch file tree");
      }
      const payload = (await response.json()) as { tree: TreeNode[] };
      setTree(payload.tree);
      const firstFile = treeFiles(payload.tree)[0] ?? null;
      setSelectedPath((current) => current ?? firstFile);
      return payload.tree;
    },
    [projectId, workingCopyId],
  );

  const loadFile = useCallback(
    async (path: string, options?: { force?: boolean }) => {
      if (!revisionId && !workingCopyId) {
        return;
      }
      if (!options?.force && fileCacheRef.current[path]) {
        return;
      }

      const search = new URLSearchParams({ path }).toString();
      const sourceUrl = workingCopyId
        ? `/api/projects/${projectId}/working-copies/${workingCopyId}/file?${search}`
        : `/api/projects/${projectId}/revisions/${revisionId}/file?${search}`;
      const response = await fetch(sourceUrl, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch file");
      }
      const payload = (await response.json()) as {
        file: { path: string; content: string; language: Language };
      };

      setFileCache((current) => ({
        ...current,
        [payload.file.path]: {
          content: payload.file.content,
          language: payload.file.language,
        },
      }));
    },
    [projectId, revisionId, workingCopyId],
  );

  useEffect(() => {
    fileCacheRef.current = {};
    setFileCache({});
    setOpenTabs([]);
    setDirtyPaths([]);
    setSelectedPath(null);
  }, [revisionId]);

  useEffect(() => {
    fileCacheRef.current = {};
    setFileCache({});
    setDirtyPaths([]);
  }, [workingCopyId]);

  useEffect(() => {
    if (!revisionId) {
      return;
    }

    loadTree(revisionId).catch((error: unknown) => {
      onError(
        error instanceof Error ? error.message : "Unable to load revision tree",
      );
    });
  }, [revisionId, loadTree, onError]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }

    loadFile(selectedPath).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : "Unable to load file");
    });
  }, [selectedPath, loadFile, onError]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }

    setOpenTabs((current) =>
      current.includes(selectedPath) ? current : [...current, selectedPath],
    );
  }, [selectedPath]);

  useEffect(() => {
    const availablePaths = new Set(allFiles);
    setOpenTabs((current) => {
      const next = current.filter((path) => availablePaths.has(path));
      if (next.length === current.length) {
        return current;
      }

      setSelectedPath((currentSelected) => {
        if (!currentSelected || !availablePaths.has(currentSelected)) {
          return next[0] ?? null;
        }
        return currentSelected;
      });

      return next;
    });
    setDirtyPaths((current) =>
      current.filter((path) => availablePaths.has(path)),
    );
  }, [allFiles]);

  useEffect(() => {
    const directoryPaths: string[] = [];
    const collect = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type !== "directory") {
          continue;
        }
        directoryPaths.push(node.path);
        collect(node.children ?? []);
      }
    };
    collect(tree);

    setExpandedDirectories((current) => {
      if (!directoryPaths.length) {
        return [];
      }

      if (!current.length) {
        return directoryPaths;
      }

      return current.filter((entry) => directoryPaths.includes(entry));
    });
  }, [tree]);

  useEffect(() => {
    if (!isInlineNewFile) {
      return;
    }

    newFileInputRef.current?.focus();
    newFileInputRef.current?.select();
  }, [isInlineNewFile]);

  useEffect(() => {
    if (!isInlineNewFile) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (inlineNewFileRowRef.current?.contains(target)) {
        return;
      }

      setIsInlineNewFile(false);
      setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
      setInlineNewFileParentPath(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isInlineNewFile]);

  const ensureWorkingCopy = useCallback(async () => {
    if (!revisionId) {
      throw new Error("No revision available for editing");
    }

    if (workingCopyId) {
      return workingCopyId;
    }

    const response = await fetch(
      `/api/projects/${projectId}/revisions/${revisionId}/working-copy`,
      {
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error("Failed to create working copy");
    }

    const payload = (await response.json()) as { workingCopy: { id: string } };
    setWorkingCopyId(payload.workingCopy.id);
    return payload.workingCopy.id;
  }, [projectId, revisionId, workingCopyId]);

  const saveFilePath = useCallback(
    async (path: string, options?: { withoutBusy?: boolean }) => {
      const fileEntry = fileCache[path];
      if (!fileEntry) {
        return false;
      }

      if (!options?.withoutBusy) {
        setIsBusy(true);
      }
      onClearError();

      try {
        const activeWorkingCopyId =
          workingCopyId ?? (isEditable ? await ensureWorkingCopy() : null);
        if (!activeWorkingCopyId) {
          throw new Error("Enable editing before saving.");
        }

        const response = await fetch(
          `/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              path,
              content: fileEntry.content,
            }),
          },
        );
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Save failed");
        }

        setDirtyPaths((current) => current.filter((entry) => entry !== path));
        if (!options?.withoutBusy) {
          onActivity(`Saved ${path.split("/").pop() ?? path}.`);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Save failed";
        onError(message);
        onLog("error", message);
        return false;
      } finally {
        if (!options?.withoutBusy) {
          setIsBusy(false);
        }
      }
    },
    [
      ensureWorkingCopy,
      fileCache,
      isEditable,
      onActivity,
      onClearError,
      onError,
      onLog,
      projectId,
      workingCopyId,
    ],
  );

  const saveCurrentFile = useCallback(
    async (options?: { withoutBusy?: boolean }) => {
      if (!selectedPath) {
        return false;
      }

      return saveFilePath(selectedPath, options);
    },
    [saveFilePath, selectedPath],
  );

  const createNewFile = useCallback(
    async (pathInput: string) => {
      const normalized = normalizePath(pathInput);
      if (!normalized || normalized.includes("..")) {
        onError("Provide a valid relative file path.");
        return;
      }

      setIsBusy(true);
      onClearError();
      try {
        const activeWorkingCopyId = await ensureWorkingCopy();
        const response = await fetch(
          `/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              path: normalized,
              content: "",
            }),
          },
        );
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Failed to create file");
        }

        setIsEditable(true);
        setFileCache((current) => ({
          ...current,
          [normalized]: {
            content: "",
            language: detectLanguageFromPath(normalized),
          },
        }));
        setTree((current) =>
          buildTreeFromPaths([...new Set([...treeFiles(current), normalized])]),
        );
        openFileInEditor(normalized);
        setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
        setInlineNewFileParentPath(null);
        setIsInlineNewFile(false);
      } catch (error) {
        onError(error instanceof Error ? error.message : "Failed to create file");
      } finally {
        setIsBusy(false);
      }
    },
    [ensureWorkingCopy, onClearError, onError, openFileInEditor, projectId],
  );

  const startInlineNewFile = useCallback((parentPath?: string | null) => {
    const selectedParents = selectedPath
      ? getParentDirectories(selectedPath)
      : [];
    const selectedParentPath = selectedParents[selectedParents.length - 1] ?? null;
    const targetParentPath =
      parentPath === undefined ? selectedParentPath : parentPath;

    setInlineNewFileParentPath(targetParentPath);
    setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
    setIsInlineNewFile(true);

    if (!targetParentPath) {
      return;
    }

    const pathsToExpand = [
      ...getParentDirectories(targetParentPath),
      targetParentPath,
    ];
    setExpandedDirectories((current) => [
      ...new Set([...current, ...pathsToExpand]),
    ]);
  }, [selectedPath]);

  const cancelInlineNewFile = useCallback(() => {
    setIsInlineNewFile(false);
    setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
    setInlineNewFileParentPath(null);
  }, []);

  const submitInlineNewFile = useCallback(() => {
    const trimmedName = inlineNewFileName.trim();
    if (!trimmedName) {
      onError("Provide a valid relative file path.");
      return;
    }

    const composedPath = inlineNewFileParentPath
      ? `${inlineNewFileParentPath}/${trimmedName}`
      : trimmedName;
    void createNewFile(composedPath);
  }, [createNewFile, inlineNewFileName, inlineNewFileParentPath, onError]);

  const uploadFilesToWorkingCopy = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);
      event.target.value = "";

      if (!selectedFiles.length) {
        return;
      }

      setIsBusy(true);
      onClearError();
      try {
        const activeWorkingCopyId = await ensureWorkingCopy();
        const uploadedPaths: string[] = [];

        for (const file of selectedFiles) {
          const uploadPath = normalizePath(file.webkitRelativePath || file.name);
          if (!uploadPath || uploadPath.includes("..")) {
            throw new Error(`Invalid file path: ${file.name}`);
          }

          const content = await file.text();
          const response = await fetch(
            `/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                path: uploadPath,
                content,
              }),
            },
          );
          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            throw new Error(payload.error ?? `Failed to upload ${uploadPath}`);
          }

          uploadedPaths.push(uploadPath);
          setFileCache((current) => ({
            ...current,
            [uploadPath]: {
              content,
              language: detectLanguageFromPath(uploadPath),
            },
          }));
        }

        if (uploadedPaths.length) {
          setIsEditable(true);
          setTree((current) =>
            buildTreeFromPaths([
              ...new Set([...treeFiles(current), ...uploadedPaths]),
            ]),
          );
          openFileInEditor(uploadedPaths[0]!);
        }
      } catch (error) {
        onError(error instanceof Error ? error.message : "Upload failed");
      } finally {
        setIsBusy(false);
      }
    },
    [ensureWorkingCopy, onClearError, onError, openFileInEditor, projectId],
  );

  const refreshFiles = useCallback(async () => {
    if (!revisionId) {
      return;
    }

    const candidatePaths = [
      ...new Set(
        [...openTabs, selectedPath].filter((path): path is string =>
          Boolean(path),
        ),
      ),
    ];

    setIsBusy(true);
    onClearError();

    try {
      const nextTree = await loadTree(revisionId);
      const availablePaths = new Set(treeFiles(nextTree));
      const pathsToReload = candidatePaths.filter((path) =>
        availablePaths.has(path),
      );

      await Promise.all(pathsToReload.map((path) => loadFile(path, { force: true })));

      setDirtyPaths([]);
      onActivity("Workbench refreshed.");
      onLog("info", "Workbench refreshed.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setIsBusy(false);
    }
  }, [
    loadFile,
    loadTree,
    onActivity,
    onClearError,
    onError,
    onLog,
    openTabs,
    revisionId,
    selectedPath,
  ]);

  return {
    revisionId,
    setRevisionId,
    workingCopyId,
    setWorkingCopyId,
    isEditable,
    setIsEditable,
    isBusy,
    tree,
    selectedPath,
    setSelectedPath,
    openTabs,
    setOpenTabs,
    expandedDirectories,
    setExpandedDirectories,
    dirtyPaths,
    setDirtyPaths,
    fileCache,
    setFileCache,
    allFiles,
    isInlineNewFile,
    setIsInlineNewFile,
    inlineNewFileName,
    setInlineNewFileName,
    inlineNewFileParentPath,
    setInlineNewFileParentPath,
    inlineNewFileRowRef,
    newFileInputRef,
    openFileInEditor,
    toggleDirectory,
    closeOpenTab,
    loadTree,
    loadFile,
    ensureWorkingCopy,
    saveFilePath,
    saveCurrentFile,
    createNewFile,
    startInlineNewFile,
    cancelInlineNewFile,
    submitInlineNewFile,
    uploadFilesToWorkingCopy,
    refreshFiles,
  };
}
