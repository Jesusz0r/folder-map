import { connection } from "next/server";
import { FolderMap } from "@/components/folder-map";
import type { MountedVolume } from "@/lib/types";
import { listMountedVolumes } from "@/lib/volumes";

export default async function Home() {
  await connection();
  let volumes: MountedVolume[] = [];
  let volumesError: string | null = null;
  try {
    const listed = await listMountedVolumes();
    volumes = listed.volumes;
    volumesError = listed.error;
  } catch {
    volumesError = "Mounted volumes could not be listed.";
  }
  const startup = volumes.find((volume) => volume.startup) ?? volumes[0] ?? null;
  return (
    <FolderMap
      volumes={volumes}
      volumesError={volumesError}
      initialPath={startup?.path ?? null}
    />
  );
}
