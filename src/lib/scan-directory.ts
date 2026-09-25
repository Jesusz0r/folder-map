import { lstat, readdir, stat, statfs } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { ScanResult, TreeNode, VolumeInfo } from "@/lib/types";

const MAX_NODES = 20_000;
const MAX_DEPTH = 16;
const SCAN_BUDGET_MS = 20_000;
const BLOCKED_PREFIXES = ["/proc", "/sys", "/dev"];

type ScanState = {
  nodes: number;
  nodeLimit: number;
  truncated: boolean;
  unreadable: number;
  deadline: number;
};

export class ScanError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ScanError";
    this.status = status;
    this.code = code;
  }
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  let cursor = 0;
  const workers = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

function emptyNode(name: string, nodePath: string, kind: TreeNode["kind"]): TreeNode {
  return {
    name,
    path: nodePath,
    kind,
    size: 0,
    fileCount: kind === "file" ? 1 : 0,
    dirCount: 0,
    children: [],
  };
}

function isBlocked(target: string): boolean {
  return BLOCKED_PREFIXES.some(
    (prefix) => target === prefix || target.startsWith(`${prefix}${path.sep}`),
  );
}

function remember(state: ScanState, node: TreeNode, children: TreeNode[]) {
  if (state.nodes >= state.nodeLimit) {
    state.truncated = true;
    return;
  }
  state.nodes += 1;
  children.push(node);
}

function notFullyScanned(name: string, full: string): TreeNode {
  const node = emptyNode(name, full, "dir");
  node.error = "This folder was not fully scanned.";
  return node;
}

async function walk(dir: string, name: string, depth: number, state: ScanState): Promise<TreeNode> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    state.unreadable += 1;
    const node = emptyNode(name, dir, "dir");
    node.error =
      errno(error) === "EACCES" || errno(error) === "EPERM"
        ? "Permission denied"
        : "Could not read this folder";
    return node;
  }

  const files: { name: string; full: string }[] = [];
  const dirs: { name: string; full: string }[] = [];
  const links: TreeNode[] = [];

  for (const entry of dirents) {
    const full = path.join(dir, entry.name);
    // Other disks live under /Volumes and are chosen from the volume list.
    if (dir === "/" && entry.name === "Volumes") continue;
    if (isBlocked(full)) continue;
    if (entry.isSymbolicLink()) {
      links.push(emptyNode(entry.name, full, "symlink"));
      continue;
    }
    if (entry.isDirectory()) {
      dirs.push({ name: entry.name, full });
      continue;
    }
    if (entry.isFile()) files.push({ name: entry.name, full });
  }

  const fileNodes = await mapLimit(files, 32, async (file) => {
    if (Date.now() > state.deadline) {
      state.truncated = true;
      return null;
    }
    try {
      const info = await stat(file.full);
      const node = emptyNode(file.name, file.full, "file");
      node.size = info.size;
      return node;
    } catch {
      state.unreadable += 1;
      const node = emptyNode(file.name, file.full, "file");
      node.error = "Could not read size";
      return node;
    }
  });

  const children: TreeNode[] = [];
  let size = 0;
  let fileCount = 0;
  let dirCount = 0;

  const sizedFiles = fileNodes.filter((node): node is TreeNode => node !== null);
  sizedFiles.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  for (const node of sizedFiles) {
    size += node.size;
    fileCount += 1;
    remember(state, node, children);
  }
  if (fileNodes.some((node) => node === null)) state.truncated = true;

  for (const link of links) remember(state, link, children);

  // Split the budget across the top level so one deep folder cannot hide the rest of a disk.
  const savedDeadline = state.deadline;
  const savedLimit = state.nodeLimit;
  for (let index = 0; index < dirs.length; index += 1) {
    const sub = dirs[index];
    if (state.nodes >= savedLimit || depth >= MAX_DEPTH || Date.now() > savedDeadline) {
      state.truncated = true;
      for (const rest of dirs.slice(index)) {
        if (state.nodes >= savedLimit) break;
        state.nodes += 1;
        children.push(notFullyScanned(rest.name, rest.full));
        dirCount += 1;
      }
      break;
    }

    if (depth === 0 && dirs.length > 0) {
      const remainingDirs = dirs.length - index;
      const timeLeft = Math.max(0, savedDeadline - Date.now());
      const nodesLeft = Math.max(0, savedLimit - state.nodes);
      const timeShare = Math.max(200, Math.floor(timeLeft / remainingDirs));
      const nodeShare = Math.max(24, Math.floor(nodesLeft / remainingDirs));
      state.deadline = Math.min(savedDeadline, Date.now() + timeShare);
      state.nodeLimit = Math.min(savedLimit, state.nodes + 1 + nodeShare);
    }

    state.nodes += 1;
    const child = await walk(sub.full, sub.name, depth + 1, state);
    state.deadline = savedDeadline;
    state.nodeLimit = savedLimit;
    children.push(child);
    size += child.size;
    fileCount += child.fileCount;
    dirCount += 1 + child.dirCount;
  }
  state.deadline = savedDeadline;
  state.nodeLimit = savedLimit;

  children.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

  return {
    name,
    path: dir,
    kind: "dir",
    size,
    fileCount,
    dirCount,
    children,
  };
}

async function readVolume(root: string): Promise<VolumeInfo | null> {
  try {
    const info = await statfs(root);
    return {
      totalBytes: Number(info.blocks) * Number(info.bsize),
      freeBytes: Number(info.bavail) * Number(info.bsize),
    };
  } catch {
    return null;
  }
}

export async function scanDirectory(requested: string | null): Promise<ScanResult> {
  const started = Date.now();
  const trimmed = requested?.trim() ?? "";
  if (trimmed.includes("\0")) {
    throw new ScanError("That path is not valid.", 400, "invalid");
  }
  if (trimmed.length > 4096) {
    throw new ScanError("That path is too long.", 400, "invalid");
  }

  if (!trimmed) {
    throw new ScanError("Choose a volume or a folder to scan.", 400, "invalid");
  }
  let root = path.resolve(trimmed);
  if (root === path.join(process.cwd(), "sample-disk")) {
    throw new ScanError("Choose a volume or a folder on this Mac.", 400, "invalid");
  }

  if (isBlocked(root)) {
    throw new ScanError(
      "That path is a virtual filesystem. Pick a normal folder.",
      400,
      "blocked",
    );
  }

  let info;
  try {
    info = await lstat(root);
  } catch (error) {
    if (errno(error) === "ENOENT") {
      throw new ScanError("No folder at that path.", 404, "not_found");
    }
    if (errno(error) === "EACCES" || errno(error) === "EPERM") {
      throw new ScanError("Permission denied for that folder.", 403, "forbidden");
    }
    throw new ScanError("That folder could not be opened.", 400, "unavailable");
  }

  if (info.isSymbolicLink()) {
    try {
      root = await fsRealpath(root);
      info = await stat(root);
    } catch {
      throw new ScanError("That shortcut does not point at a folder.", 400, "not_directory");
    }
  }

  if (!info.isDirectory()) {
    throw new ScanError("That path is a file. Choose a folder.", 400, "not_directory");
  }

  const state: ScanState = {
    nodes: 1,
    nodeLimit: MAX_NODES,
    truncated: false,
    unreadable: 0,
    deadline: started + SCAN_BUDGET_MS,
  };
  const base = path.basename(root) || root;
  const tree = await walk(root, base, 0, state);
  const volume = await readVolume(root);

  return {
    root,
    name: tree.name,
    size: tree.size,
    fileCount: tree.fileCount,
    dirCount: tree.dirCount,
    unreadable: state.unreadable,
    truncated: state.truncated,
    scannedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    volume,
    tree,
  };
}

async function fsRealpath(target: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(target);
}
