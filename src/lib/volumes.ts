import { lstat, readdir, realpath, stat, statfs } from "node:fs/promises";
import path from "node:path";
import type { MountedVolume } from "./types.ts";

export type VolumeMount = {
  name: string;
  /** Canonical path after resolving links. `/` is the startup disk. */
  realPath: string;
  /** Path the user sees and the scanner opens. */
  mountPath: string;
  totalBytes: number | null;
  freeBytes: number | null;
};

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function readCapacity(target: string): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    const info = await statfs(target);
    return {
      totalBytes: Number(info.blocks) * Number(info.bsize),
      freeBytes: Number(info.bavail) * Number(info.bsize),
    };
  } catch {
    return null;
  }
}

/**
 * `/Volumes/<startup>` is a symlink to `/` on macOS. List that disk once,
 * under the name from `/Volumes`, and scan `/` so paths stay on the startup disk.
 */
export function assembleVolumes(mounts: readonly VolumeMount[]): MountedVolume[] {
  const startupMount = mounts.find((mount) => mount.realPath === "/");
  const startup: MountedVolume = {
    id: "startup",
    name: startupMount?.name || "Startup disk",
    path: "/",
    startup: true,
    totalBytes: startupMount?.totalBytes ?? null,
    freeBytes: startupMount?.freeBytes ?? null,
  };
  const others = mounts
    .filter((mount) => mount.realPath !== "/")
    .map((mount) => ({
      id: mount.mountPath,
      name: mount.name,
      path: mount.mountPath,
      startup: false,
      totalBytes: mount.totalBytes,
      freeBytes: mount.freeBytes,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return [startup, ...others];
}

export async function listMountedVolumes(): Promise<{ volumes: MountedVolume[]; error: string | null }> {
  const mounts: VolumeMount[] = [];
  let error: string | null = null;
  const rootCapacity = await readCapacity("/");

  try {
    const entries = await readdir("/Volumes", { withFileTypes: true });
    for (const entry of entries) {
      const mountPath = path.join("/Volumes", entry.name);
      try {
        const linked = await lstat(mountPath);
        if (!linked.isDirectory() && !linked.isSymbolicLink()) continue;
        const info = await stat(mountPath);
        if (!info.isDirectory()) continue;
        const realPath = await realpath(mountPath);
        const capacity = realPath === "/" ? rootCapacity : await readCapacity(mountPath);
        mounts.push({
          name: entry.name,
          realPath,
          mountPath,
          totalBytes: capacity?.totalBytes ?? null,
          freeBytes: capacity?.freeBytes ?? null,
        });
      } catch {
        mounts.push({
          name: entry.name,
          realPath: mountPath,
          mountPath,
          totalBytes: null,
          freeBytes: null,
        });
      }
    }
  } catch (cause) {
    const denied = errno(cause) === "EACCES" || errno(cause) === "EPERM";
    error = denied
      ? "Permission denied while reading other disks. The startup disk is still listed."
      : "Other disks could not be listed. The startup disk is still listed.";
  }

  if (!mounts.some((mount) => mount.realPath === "/")) {
    mounts.unshift({
      name: "Startup disk",
      realPath: "/",
      mountPath: "/",
      totalBytes: rootCapacity?.totalBytes ?? null,
      freeBytes: rootCapacity?.freeBytes ?? null,
    });
  }

  return { volumes: assembleVolumes(mounts), error };
}
