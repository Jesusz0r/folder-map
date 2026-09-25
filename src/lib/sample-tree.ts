import { mkdir, open, symlink, writeFile, access } from "node:fs/promises";
import path from "node:path";

const MARKER = ".seeded";

/** Apparent sizes only. Files are sparse so the sample stays cheap to create. */
const FILES: { rel: string; bytes: number }[] = [
  { rel: "containers/docker/images/postgres-16.tar", bytes: 8_600_000 },
  { rel: "containers/docker/images/node-22.tar", bytes: 5_400_000 },
  { rel: "containers/docker/volumes/pgdata.bin", bytes: 1_800_000 },
  { rel: "projects/ios/DerivedData/ModuleCache.noindex/cache.bin", bytes: 5_200_000 },
  { rel: "projects/ios/DerivedData/Build/Products/Debug.app", bytes: 2_600_000 },
  { rel: "projects/ios/Archives/App.xcarchive", bytes: 1_100_000 },
  { rel: "projects/web/node_modules/next/dist/compiled.js", bytes: 1_600_000 },
  { rel: "projects/web/node_modules/react-dom/cjs/react-dom.js", bytes: 900_000 },
  { rel: "projects/web/node_modules/typescript/lib/typescript.js", bytes: 1_200_000 },
  { rel: "projects/web/node_modules/lucide/dist/icons.js", bytes: 700_000 },
  { rel: "projects/web/src/app/page.tsx", bytes: 4_200 },
  { rel: "projects/web/src/app/layout.tsx", bytes: 1_800 },
  { rel: "projects/web/src/components/treemap.tsx", bytes: 6_400 },
  { rel: "projects/web/src/lib/format.ts", bytes: 900 },
  { rel: "documents/photos/trip/IMG_2041.heic", bytes: 1_400_000 },
  { rel: "documents/photos/trip/IMG_2042.heic", bytes: 1_100_000 },
  { rel: "documents/photos/scans/page-1.tiff", bytes: 800_000 },
  { rel: "documents/archives/backup-2024.zip", bytes: 1_600_000 },
  { rel: "documents/notes/empty.txt", bytes: 0 },
  { rel: "caches/adobe/Media Cache/preview.cfa", bytes: 1_900_000 },
  { rel: "caches/user/helpd/cache.db", bytes: 680_000 },
  { rel: "system/logs/install.log", bytes: 420_000 },
  { rel: "system/logs/system.log", bytes: 180_000 },
];

export function sampleRoot(): string {
  return path.join(process.cwd(), "sample-disk");
}

export async function ensureSampleTree(root: string): Promise<void> {
  const marker = path.join(root, MARKER);
  try {
    await access(marker);
    return;
  } catch {
    // Create the tree below.
  }

  await mkdir(root, { recursive: true });
  for (const file of FILES) {
    const full = path.join(root, file.rel);
    await mkdir(path.dirname(full), { recursive: true });
    const handle = await open(full, "w");
    try {
      await handle.truncate(file.bytes);
    } finally {
      await handle.close();
    }
  }

  const link = path.join(root, "documents/notes/shortcut");
  try {
    await symlink("readme.md", link);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
  }

  await writeFile(
    path.join(root, "documents/notes/readme.md"),
    "Sample folder for Folder Map. These files are sparse stand-ins, not real project data.\n",
  );
  await writeFile(marker, "generated sample tree\n");
}
