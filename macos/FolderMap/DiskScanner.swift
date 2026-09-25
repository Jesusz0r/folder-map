import Darwin
import Foundation

enum DiskScanner {
    private static let maxNodes = 20_000
    private static let maxDepth = 16
    private static let budget: TimeInterval = 20
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

        let state = ScanState(deadline: started.addingTimeInterval(budget), nodeLimit: maxNodes)
        let base = (root as NSString).lastPathComponent
        let name = base.isEmpty ? root : base
        guard let tree = walk(dir: root, name: name, depth: 0, state: state, isCancelled: isCancelled) else {
            return .cancelled
        }
        if isCancelled() { return .cancelled }

        var problems: [String] = []
        collectProblems(tree, into: &problems)
        let elapsed = Int(Date().timeIntervalSince(started) * 1000)
        return .success(
            ScanResult(
                root: root,
                name: tree.name,
                size: tree.size,
                fileCount: tree.fileCount,
                dirCount: tree.dirCount,
                unreadable: state.unreadable,
                truncated: state.truncated,
                elapsedMs: elapsed,
                volume: VolumeList.capacity(root),
                tree: tree,
                problemPaths: problems
            )
        )
    }

    private static func walk(
        dir: String,
        name: String,
        depth: Int,
        state: ScanState,
        isCancelled: () -> Bool
    ) -> TreeNode? {
        if isCancelled() { return nil }
        let entries: [DirEntry]
        do {
            entries = try readEntries(dir)
        } catch {
            state.addUnreadable()
            var node = emptyNode(name: name, path: dir, kind: .directory)
            node.error = isPermission(error) ? "Permission denied" : "Could not read this folder"
            return node
        }

        var files: [(name: String, full: String)] = []
        var dirs: [(name: String, full: String)] = []
        var links: [TreeNode] = []
        for entry in entries {
            let full = childPath(dir, entry.name)
            // Other disks live under /Volumes and are chosen from the volume list.
            if dir == "/" && entry.name == "Volumes" { continue }
            if isBlocked(full) { continue }
            switch entry.kind {
            case .symlink:
                links.append(emptyNode(name: entry.name, path: full, kind: .symlink))
            case .directory:
                dirs.append((entry.name, full))
            case .file:
                files.append((entry.name, full))
            case .other:
                break
            }
        }

        let fileNodes = statFiles(files, state: state)
        var children: [TreeNode] = []
        var size: Int64 = 0
        var fileCount = 0
        var dirCount = 0

        let sizedFiles = fileNodes.compactMap { $0 }.sorted { lhs, rhs in
            if lhs.size != rhs.size { return lhs.size > rhs.size }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
        for node in sizedFiles {
            size += node.size
            fileCount += 1
            remember(node, state: state, into: &children)
        }
        if fileNodes.contains(where: { $0 == nil }) {
            state.markTruncated()
        }
        for link in links {
            remember(link, state: state, into: &children)
        }

        let savedDeadline = state.deadline
        let savedLimit = state.nodeLimit
        var index = 0
        while index < dirs.count {
            if isCancelled() { return nil }
            let sub = dirs[index]
            if state.nodes >= savedLimit || depth >= maxDepth || Date() > savedDeadline {
                state.markTruncated()
                for rest in dirs[index...] {
                    if state.nodes >= savedLimit { break }
                    state.nodes += 1
                    children.append(notFullyScanned(name: rest.name, path: rest.full))
                    dirCount += 1
                }
                break
            }

            if depth == 0 && !dirs.isEmpty {
                let remainingDirs = dirs.count - index
                let timeLeft = max(0, savedDeadline.timeIntervalSinceNow * 1000)
                let nodesLeft = max(0, savedLimit - state.nodes)
                let timeShare = max(200, Int(timeLeft / Double(remainingDirs)))
                let nodeShare = max(24, nodesLeft / remainingDirs)
                state.deadline = min(savedDeadline, Date().addingTimeInterval(Double(timeShare) / 1000))
                state.nodeLimit = min(savedLimit, state.nodes + 1 + nodeShare)
            }

            state.nodes += 1
            guard let child = walk(dir: sub.full, name: sub.name, depth: depth + 1, state: state, isCancelled: isCancelled) else {
                return nil
            }
            state.deadline = savedDeadline
            state.nodeLimit = savedLimit
            children.append(child)
            size += child.size
            fileCount += child.fileCount
            dirCount += 1 + child.dirCount
            index += 1
        }
        state.deadline = savedDeadline
        state.nodeLimit = savedLimit

        children.sort { lhs, rhs in
            if lhs.size != rhs.size { return lhs.size > rhs.size }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
        return TreeNode(
            name: name,
            path: dir,
            kind: .directory,
            size: size,
            fileCount: fileCount,
            dirCount: dirCount,
            children: children,
            error: nil
        )
    }

    private static func statFiles(_ files: [(name: String, full: String)], state: ScanState) -> [TreeNode?] {
        if files.isEmpty { return [] }
        var results = [TreeNode?](repeating: nil, count: files.count)
        let lock = NSLock()
        let group = DispatchGroup()
        let semaphore = DispatchSemaphore(value: 32)
        let queue = DispatchQueue(label: "folder-map.stat", attributes: .concurrent)
        for (index, file) in files.enumerated() {
            if state.isPastDeadline {
                state.markTruncated()
                break
            }
            semaphore.wait()
            if state.isPastDeadline {
                semaphore.signal()
                state.markTruncated()
                break
            }
            group.enter()
            queue.async {
                defer {
                    semaphore.signal()
                    group.leave()
                }
                if state.isPastDeadline {
                    state.markTruncated()
                    return
                }
                var info = Darwin.stat()
                let node: TreeNode
                if Posix.stat(file.full, &info) == 0 {
                    var sized = emptyNode(name: file.name, path: file.full, kind: .file)
                    sized.size = Int64(info.st_size)
                    node = sized
                } else {
                    state.addUnreadable()
                    var missing = emptyNode(name: file.name, path: file.full, kind: .file)
                    missing.error = "Could not read size"
                    node = missing
                }
                lock.lock()
                results[index] = node
                lock.unlock()
            }
        }
        group.wait()
        return results
    }

    private static func remember(_ node: TreeNode, state: ScanState, into children: inout [TreeNode]) {
        if state.nodes >= state.nodeLimit {
            state.markTruncated()
            return
        }
        state.nodes += 1
        children.append(node)
    }

    private static func emptyNode(name: String, path: String, kind: NodeKind) -> TreeNode {
        TreeNode(
            name: name,
            path: path,
            kind: kind,
            size: 0,
            fileCount: kind == .file ? 1 : 0,
            dirCount: 0,
            children: [],
            error: nil
        )
    }

    private static func notFullyScanned(name: String, path: String) -> TreeNode {
        var node = emptyNode(name: name, path: path, kind: .directory)
        node.error = "This folder was not fully scanned."
        return node
    }

    private static func collectProblems(_ node: TreeNode, into found: inout [String]) {
        if found.count >= 5 { return }
        if let error = node.error, error != "This folder was not fully scanned." {
            found.append(node.path.isEmpty ? node.name : node.path)
        }
        for child in node.children {
            if found.count >= 5 { return }
            collectProblems(child, into: &found)
        }
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

    private static func childPath(_ dir: String, _ name: String) -> String {
        dir == "/" ? "/\(name)" : "\(dir)/\(name)"
    }

    private static func isBlocked(_ target: String) -> Bool {
        blocked.contains { target == $0 || target.hasPrefix($0 + "/") }
    }

    private static func openError(_ code: Int32) -> String {
        if code == ENOENT { return "No folder at that path." }
        if code == EACCES || code == EPERM { return "Permission denied for that folder." }
        return "That folder could not be opened."
    }

    private static func isPermission(_ error: Error) -> Bool {
        let code = (error as NSError).code
        return code == Int(EACCES) || code == Int(EPERM)
    }

    private static func readEntries(_ dir: String) throws -> [DirEntry] {
        guard let handle = dir.withCString({ opendir($0) }) else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        defer { closedir(handle) }
        var entries: [DirEntry] = []
        while let raw = readdir(handle) {
            let value = raw.pointee
            let name = entryName(value)
            if name == "." || name == ".." { continue }
            entries.append(DirEntry(name: name, kind: kind(of: value, in: dir)))
        }
        return entries
    }

    private static func entryName(_ entry: dirent) -> String {
        var copy = entry
        return withUnsafePointer(to: &copy.d_name) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: 1024) {
                String(cString: $0)
            }
        }
    }

    private static func kind(of entry: dirent, in dir: String) -> EntryKind {
        switch entry.d_type {
        case UInt8(DT_LNK): return .symlink
        case UInt8(DT_DIR): return .directory
        case UInt8(DT_REG): return .file
        case UInt8(DT_UNKNOWN):
            let full = childPath(dir, entryName(entry))
            return kindFromStat(full)
        default:
            return .other
        }
    }

    private static func kindFromStat(_ path: String) -> EntryKind {
        var info = Darwin.stat()
        guard Posix.lstat(path, &info) == 0 else { return .other }
        switch info.st_mode & S_IFMT {
        case S_IFLNK: return .symlink
        case S_IFDIR: return .directory
        case S_IFREG: return .file
        default: return .other
        }
    }
}

private enum EntryKind {
    case file
    case directory
    case symlink
    case other
}

private struct DirEntry {
    var name: String
    var kind: EntryKind
}

private final class ScanState: @unchecked Sendable {
    private let lock = NSLock()
    var nodes: Int
    var nodeLimit: Int
    private var truncatedFlag = false
    private var unreadableCount = 0
    var deadline: Date

    init(deadline: Date, nodeLimit: Int) {
        self.nodes = 1
        self.nodeLimit = nodeLimit
        self.deadline = deadline
    }

    var truncated: Bool {
        lock.lock()
        defer { lock.unlock() }
        return truncatedFlag
    }

    var unreadable: Int {
        lock.lock()
        defer { lock.unlock() }
        return unreadableCount
    }

    var isPastDeadline: Bool {
        lock.lock()
        defer { lock.unlock() }
        return Date() > deadline
    }

    func markTruncated() {
        lock.lock()
        truncatedFlag = true
        lock.unlock()
    }

    func addUnreadable() {
        lock.lock()
        unreadableCount += 1
        lock.unlock()
    }
}
