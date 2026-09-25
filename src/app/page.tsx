import { connection } from "next/server";
import { FolderMap } from "@/components/folder-map";
import { ScanError, scanDirectory } from "@/lib/scan-directory";

export default async function Home() {
  await connection();
  let initial: Awaited<ReturnType<typeof scanDirectory>> | null = null;
  let initialError: string | null = null;
  try {
    initial = await scanDirectory(null);
  } catch (error) {
    initialError =
      error instanceof ScanError ? error.message : "The sample tree could not be scanned.";
  }
  return <FolderMap initial={initial} initialError={initialError} />;
}
