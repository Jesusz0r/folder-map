# Folder Map

A local treemap of a folder. Point it at a directory and every file and subfolder becomes a block sized by how much space it uses. Hover a block for the size and path, click a folder to open it, and use Up or the path to climb back out.

Folder Map reads file metadata on this machine. It can move an item you choose to the Trash, and you can restore it. It does not send file names anywhere.

Sizes are the space files take on disk (allocated blocks). A sparse file does not count as its full length, and a file with more than one name is counted once. Shortcuts are listed and not followed.

Licensed under MIT. See [LICENSE](LICENSE).

## Mac app

Folder Map is a SwiftUI app in `macos/`. It reads mounted volumes on this Mac, opens on your home folder, and draws a squarified map.

```bash
xcodebuild -project macos/FolderMap.xcodeproj -scheme FolderMap -configuration Release -destination 'platform=macOS' -derivedDataPath macos/build build
open macos/build/Build/Products/Release/FolderMap.app
```

The first window lists the startup disk and anything under `/Volumes`, then scans your home folder. Choose another volume, paste a folder path, or use Choose Folder. Folders this Mac will not open are left out of the map, with one note when that happens. A partial-scan note appears only when a scan actually hits its limit.

Click a block to select it, then Move to Trash. Folder Map asks before moving that item to the Trash, and it does not permanently delete anything. A menu-bar item shows free space on the startup disk and opens the window. In the sidebar, set a free-space alert. Folder Map posts one notification when free space drops below that mark, and it does not repeat until the disk recovers or you change the mark.
