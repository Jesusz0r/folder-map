import Darwin
import Foundation

enum DiskScanner {
    /// Safety stop so a scan cannot run away. A normal home folder finishes first.
    private static let budget: TimeInterval = 600
    /// Directories are kept. Individual files are not, so this cap is not spent on every file.
    private static let maxDirectories = 2_000_000
    private static let blocked = ["/proc", "/sys", "/dev"]

    static func scan(path requested: String, isCancelled: () -> Bool) -> ScanOutcome {
        let started = Date()
        let trimmed = requested.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return .failure("Choose a volume or a folder to scan.")
        }
        if trimmed.contains("\0") || trimmed.count > 4096 {
            return .failure(trimmed.contains("\0") ? "That path is not valid." : "That path is too long.")
        }

        var root = resolve(trimmed)
        if isBlocked(root) {
            return .failure("That path is a virtual filesystem. Pick a normal folder.")
        }

        var info = Darwin.stat()
        if Posix.lstat(root, &info) != 0 {
            return .failure(openError(errno))
        }
        if (info.st_mode & S_IFMT) == S_IFLNK {
            guard let resolved = Posix.realPath(root) else {
                return .failure("That shortcut does not point at a folder.")
            }
            root = resolved
            guard Posix.stat(root, &info) == 0 else {
                return .failure("That shortcut does not point at a folder.")
            }
        }
        if (info.st_mode & S_IFMT) != S_IFDIR {
            return .failure("That path is a file. Choose a folder.")
        }
        if isCancelled() { return .cancelled }

        let state = ScanProgress(deadline: started.addingTimeInterval(budget))
        let tree: TreeNode
        switch walk(root: root, state: state, isCancelled: isCancelled) {
        case .cancelled:
            return .cancelled
        case .failed(let message):
            return .failure(message)
        case .done(let node):
            tree = node
        }

        let elapsed = Int(Date().timeIntervalSince(started) * 1000)
        return .success(
            ScanResult(
                root: root,
                name: tree.name,
                size: tree.size,
                fileCount: tree.fileCount,
                dirCount: tree.dirCount,
                skipped: state.skipped,
                truncated: state.truncated,
                elapsedMs: elapsed,
                volume: VolumeList.capacity(root),
                tree: tree
            )
        )
    }

    /// Walk with `fts` so every readable file is counted. Unreadable directories are omitted.
    /// File bytes stay on the parent; only the largest files in each folder are kept as blocks.
    private static func walk(root: String, state: ScanProgress, isCancelled: () -> Bool) -> WalkEnd {
        guard let raw = strdup(root) else { return .failed("That path is not valid.") }
        defer { free(raw) }
        var paths: [UnsafeMutablePointer<CChar>?] = [raw, nil]
        guard let tree = paths.withUnsafeMutableBufferPointer({ buffer -> UnsafeMutablePointer<FTS>? in
            guard let base = buffer.baseAddress else { return nil }
            return fts_open(base, FTS_PHYSICAL | FTS_NOCHDIR | FTS_XDEV, nil)
        }) else {
            return .failed(openError(errno))
        }
        defer { fts_close(tree) }

        var stack: [DirBuild] = []
        var rootNode: TreeNode?
        var steps = 0
        errno = 0

        while let ent = fts_read(tree) {
            if isCancelled() { return .cancelled }
            steps += 1
            if steps & 2047 == 0, Date() > state.deadline {
                state.truncated = true
                break
            }

            let info = ent.pointee.fts_info
            switch info {
            case UInt16(FTS_D):
                let path = entryPath(ent)
                let frame = DirBuild(name: displayName(path), path: path)
                let omit = shouldOmit(path, root: root)
                if omit || (ent.pointee.fts_level > 0 && state.directories >= maxDirectories) {
                    if !omit { state.truncated = true }
                    frame.omit = true
                    fts_set(tree, ent, FTS_SKIP)
                } else {
                    state.directories += 1
                }
                stack.append(frame)

            case UInt16(FTS_DNR):
                let path = entryPath(ent)
                if ent.pointee.fts_level == 0 {
                    let code = ent.pointee.fts_errno
                    return .failed(openError(code == 0 ? EACCES : code))
                }
                if stack.last?.path == path {
                    _ = stack.popLast()
                }
                state.skipped += 1

            case UInt16(FTS_DP):
                guard let frame = stack.popLast() else { continue }
                if frame.omit { continue }
                let node = frame.materialize()
                if stack.isEmpty {
                    rootNode = node
                } else {
                    stack[stack.count - 1].addDirectory(node)
                }

            case UInt16(FTS_F):
                guard let frame = stack.last, !frame.omit else { continue }
                let size = Int64(ent.pointee.fts_statp.pointee.st_size)
                frame.addFile(size: size) {
                    let path = entryPath(ent)
                    return ((path as NSString).lastPathComponent, path)
                }

            case UInt16(FTS_SL), UInt16(FTS_SLNONE):
                guard let frame = stack.last, !frame.omit else { continue }
                let path = entryPath(ent)
                frame.addSymlink(name: (path as NSString).lastPathComponent, path: path)

            case UInt16(FTS_ERR), UInt16(FTS_NS):
                if ent.pointee.fts_level == 0 {
                    let code = ent.pointee.fts_errno
                    return .failed(openError(code == 0 ? EIO : code))
                }

            default:
                break
            }
        }

        if isCancelled() { return .cancelled }
        if rootNode == nil {
            if Date() > state.deadline || errno != 0 {
                state.truncated = true
            }
            rootNode = fold(stack)
        }
        guard let rootNode else {
            return .failed("That folder could not be opened.")
        }
        return .done(rootNode)
    }

    private static func fold(_ stack: [DirBuild]) -> TreeNode? {
        var frames = stack
        var pending: TreeNode?
        while let frame = frames.popLast() {
            if frame.omit {
                pending = nil
                continue
            }
            if let child = pending {
                frame.addDirectory(child)
            }
            pending = frame.materialize()
        }
        return pending
    }

    private static func entryPath(_ ent: UnsafeMutablePointer<FTSENT>) -> String {
        String(cString: ent.pointee.fts_path)
    }

    private static func displayName(_ path: String) -> String {
        if path == "/" { return "/" }
        let base = (path as NSString).lastPathComponent
        return base.isEmpty ? path : base
    }

    private static func shouldOmit(_ path: String, root: String) -> Bool {
        if isBlocked(path) { return true }
        if root == "/" && (path == "/Volumes" || path.hasPrefix("/Volumes/")) { return true }
        return false
    }

    private static func resolve(_ path: String) -> String {
        let expanded = (path as NSString).expandingTildeInPath
        let absolute: String
        if expanded.hasPrefix("/") {
            absolute = expanded
        } else {
            absolute = (NSHomeDirectory() as NSString).appendingPathComponent(expanded)
        }
        return (absolute as NSString).standardizingPath
    }

    private static func isBlocked(_ target: String) -> Bool {
        blocked.contains { target == $0 || target.hasPrefix($0 + "/") }
    }

    private static func openError(_ code: Int32) -> String {
        if code == ENOENT { return "No folder at that path." }
        if code == EACCES || code == EPERM { return "Permission denied for that folder." }
        return "That folder could not be opened."
    }
}

private enum WalkEnd {
    case done(TreeNode)
    case failed(String)
    case cancelled
}

private final class DirBuild {
    static let keepLimit = 32
    static let linkLimit = 64

    let name: String
    let path: String
    var omit = false
    var size: Int64 = 0
    var fileCount = 0
    var dirCount = 0
    var children: [TreeNode] = []
    private var kept: [Kept] = []
    private var otherSize: Int64 = 0
    private var otherCount = 0
    private var links = 0

    init(name: String, path: String) {
        self.name = name
        self.path = path
    }

    func addFile(size: Int64, identity: () -> (name: String, path: String)) {
        fileCount += 1
        self.size += size
        guard size > 0 else { return }
        if kept.count < Self.keepLimit {
            let made = identity()
            kept.append(Kept(name: made.name, path: made.path, size: size))
            return
        }
        var smallestIndex = 0
        for index in 1..<kept.count where kept[index].size < kept[smallestIndex].size {
            smallestIndex = index
        }
        if size <= kept[smallestIndex].size {
            otherSize += size
            otherCount += 1
            return
        }
        otherSize += kept[smallestIndex].size
        otherCount += 1
        let made = identity()
        kept[smallestIndex] = Kept(name: made.name, path: made.path, size: size)
    }

    func addSymlink(name: String, path: String) {
        guard links < Self.linkLimit else { return }
        links += 1
        children.append(
            TreeNode(
                name: name,
                path: path,
                kind: .symlink,
                size: 0,
                fileCount: 0,
                dirCount: 0,
                children: [],
                error: nil
            )
        )
    }

    func addDirectory(_ node: TreeNode) {
        size += node.size
        fileCount += node.fileCount
        dirCount += 1 + node.dirCount
        children.append(node)
    }

    func materialize() -> TreeNode {
        var items = children
        for file in kept {
            items.append(
                TreeNode(
                    name: file.name,
                    path: file.path,
                    kind: .file,
                    size: file.size,
                    fileCount: 1,
                    dirCount: 0,
                    children: [],
                    error: nil
                )
            )
        }
        if otherCount > 0, otherSize > 0 {
            items.append(
                TreeNode(
                    name: "Other files (\(otherCount))",
                    path: "",
                    kind: .file,
                    size: otherSize,
                    fileCount: otherCount,
                    dirCount: 0,
                    children: [],
                    error: nil
                )
            )
        }
        items.sort { lhs, rhs in
            if lhs.size != rhs.size { return lhs.size > rhs.size }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
        return TreeNode(
            name: name,
            path: path,
            kind: .directory,
            size: size,
            fileCount: fileCount,
            dirCount: dirCount,
            children: items,
            error: nil
        )
    }
}

private struct Kept {
    var name: String
    var path: String
    var size: Int64
}

private final class ScanProgress {
    var skipped = 0
    var truncated = false
    var directories = 0
    let deadline: Date

    init(deadline: Date) {
        self.deadline = deadline
    }
}
