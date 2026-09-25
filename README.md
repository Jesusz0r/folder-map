# Folder Map

A local treemap of a folder. Point it at a directory and every file and subfolder becomes a block sized by how much space it uses. Hover a block for the size and path, click a folder to open it, and use Up or the path to climb back out.

Folder Map reads file metadata on this machine. It can move an item you choose to the Trash, and you can restore it. It does not send file names anywhere.

Sizes are the space files take on disk (allocated blocks). A sparse file does not count as its full length, and a file with more than one name is counted once. Shortcuts are listed and not followed.

Licensed under MIT. See [LICENSE](LICENSE).

## Mac app

Folder Map is a SwiftUI app in `macos/`. It reads mounted volumes on this Mac, opens on your home folder, and draws the same squarified map.

```bash
xcodebuild -project macos/FolderMap.xcodeproj -scheme FolderMap -configuration Release -destination 'platform=macOS' -derivedDataPath macos/build build
open macos/build/Build/Products/Release/FolderMap.app
```

The first window lists the startup disk and anything under `/Volumes`, then scans your home folder. Choose another volume, paste a folder path, or use Choose Folder. Folders this Mac will not open are left out of the map, with one note when that happens. A partial-scan note appears only when a scan actually hits its limit.

Click a block to select it, then Move to Trash. Folder Map asks before moving that item to the Trash, and it does not permanently delete anything. A menu-bar item shows free space on the startup disk and opens the window. In the sidebar, set a free-space alert. Folder Map posts one notification when free space drops below that mark, and it does not repeat until the disk recovers or you change the mark.

## Web app

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
