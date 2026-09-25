# Folder Map

A local treemap of a folder. Point it at a directory and every file and subfolder becomes a block sized by how much space it uses. Hover a block for the size and path, click a folder to open it, and use Up or the path to climb back out.

Folder Map reads file metadata on this machine. It does not delete anything, and it does not send file names anywhere.

Sizes are apparent lengths (what the filesystem reports for each file), not allocated blocks. Shortcuts are listed and not followed.

Licensed under MIT. See [LICENSE](LICENSE).

## Run it

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4721](http://127.0.0.1:4721).

The first view lists mounted volumes: the startup disk, plus anything under `/Volumes`. It then scans the startup disk. Pick another volume, or paste a folder path and press Scan.

A large volume can take about 20 seconds. If the scan hits that limit, or a folder denies access, the map stays up and says what is missing.

```bash
npm run lint
npm test
npm run build
```

## API

`GET /api/volumes` lists the startup disk and other mounted volumes. The response is names, paths, and free space. It does not scan file trees.

`GET /api/scan?path=/absolute/or/relative/folder` reads that folder. The response is metadata only: names, paths, and sizes. File contents are never returned.

The dev server can read any folder the process can access. Keep it on your own machine.
