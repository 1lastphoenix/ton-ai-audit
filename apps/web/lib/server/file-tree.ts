import { normalizePath } from "@ton-audit/shared";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

type MutableNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children: Map<string, MutableNode>;
};

function toTreeNode(node: MutableNode): FileTreeNode {
  if (node.type === "file") {
    return {
      name: node.name,
      path: node.path,
      type: "file"
    };
  }

  const childNodes = [...node.children.values()]
    .map(toTreeNode)
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  return {
    name: node.name,
    path: node.path,
    type: "directory",
    children: childNodes
  };
}

export function buildFileTree(filePaths: string[]): FileTreeNode[] {
  const root = new Map<string, MutableNode>();

  for (const rawPath of filePaths) {
    const normalizedPath = normalizePath(rawPath);
    if (!normalizedPath) {
      continue;
    }

    const parts = normalizedPath.split("/").filter(Boolean);
    if (!parts.length) {
      continue;
    }

    let currentChildren = root;
    let currentPath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const isLeaf = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!currentChildren.has(part)) {
        currentChildren.set(part, {
          name: part,
          path: currentPath,
          type: isLeaf ? "file" : "directory",
          children: new Map<string, MutableNode>()
        });
      }

      const node = currentChildren.get(part)!;
      if (!isLeaf) {
        node.type = "directory";
        currentChildren = node.children;
      }
    }
  }

  return [...root.values()]
    .map(toTreeNode)
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}
