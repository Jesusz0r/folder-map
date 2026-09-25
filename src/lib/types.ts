export type NodeKind = "file" | "dir" | "symlink";

export type TreeNode = {
  name: string;
  path: string;
  kind: NodeKind;
  size: number;
  fileCount: number;
  dirCount: number;
  children: TreeNode[];
  error?: string;
};

export type VolumeInfo = {
  totalBytes: number;
  freeBytes: number;
};

export type ScanResult = {
  root: string;
  name: string;
  size: number;
  fileCount: number;
  dirCount: number;
  unreadable: number;
  truncated: boolean;
  scannedAt: string;
  elapsedMs: number;
  volume: VolumeInfo | null;
  tree: TreeNode;
};

export type ScanErrorBody = {
  error: string;
  code?: string;
};
