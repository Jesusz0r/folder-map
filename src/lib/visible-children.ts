import type { TreeNode } from "@/lib/types";

const MAX_BLOCKS = 16;

/** Largest entries for the treemap. The tail is grouped so small files stay readable. */
export function treemapChildren(node: TreeNode): TreeNode[] {
  const sized = node.children.filter((child) => child.size > 0);
  if (sized.length <= MAX_BLOCKS) return sized;

  const head = sized.slice(0, MAX_BLOCKS - 1);
  const rest = sized.slice(MAX_BLOCKS - 1);
  const other: TreeNode = {
    name: `Other (${rest.length})`,
    path: "",
    kind: "dir",
    size: rest.reduce((sum, child) => sum + child.size, 0),
    fileCount: rest.reduce((sum, child) => sum + child.fileCount, 0),
    dirCount: rest.reduce(
      (sum, child) => sum + (child.kind === "dir" ? 1 + child.dirCount : 0),
      0,
    ),
    children: rest,
  };

  return [...head, other];
}
