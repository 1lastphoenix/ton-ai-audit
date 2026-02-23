export type WorkbenchTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkbenchTreeNode[];
};

type MonacoTheme = "vs" | "vs-dark";

export function resolveMonacoTheme(options: {
  resolvedTheme?: string;
  prefersDark?: boolean;
}): MonacoTheme {
  const { resolvedTheme, prefersDark = false } = options;

  if (resolvedTheme === "dark") {
    return "vs-dark";
  }
  if (resolvedTheme === "light") {
    return "vs";
  }
  if (resolvedTheme === "system") {
    return prefersDark ? "vs-dark" : "vs";
  }

  return prefersDark ? "vs-dark" : "vs";
}

export function filterWorkbenchTree(nodes: WorkbenchTreeNode[], rawQuery: string): WorkbenchTreeNode[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return nodes;
  }

  return nodes
    .map((node) => filterNode(node, query))
    .filter((node): node is WorkbenchTreeNode => node !== null);
}

function filterNode(node: WorkbenchTreeNode, query: string): WorkbenchTreeNode | null {
  const nameMatch = node.name.toLowerCase().includes(query);
  const pathMatch = node.path.toLowerCase().includes(query);
  const isMatch = nameMatch || pathMatch;

  if (node.type === "file") {
    return isMatch ? node : null;
  }

  const filteredChildren = (node.children ?? [])
    .map((child) => filterNode(child, query))
    .filter((child): child is WorkbenchTreeNode => child !== null);

  if (!isMatch && filteredChildren.length === 0) {
    return null;
  }

  return {
    ...node,
    children: filteredChildren
  };
}
