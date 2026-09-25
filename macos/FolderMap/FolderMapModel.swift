import AppKit
import Foundation

@MainActor
final class FolderMapModel: ObservableObject {
    @Published var volumes: [MountedVolume] = []
    @Published var volumesError: String?
    @Published var status: LoadState = .loading
    @Published var error: String?
    @Published var result: ScanResult?
    @Published var pathInput = ""
    @Published var pendingPath = ""
    @Published var stack: [TreeNode] = []
    @Published var hover: TreeNode?
    @Published var selection: TreeNode?
    @Published var pendingTrash: TreeNode?
    @Published var trashError: String?
    @Published var slow = false

    private var generation = 0
    private var didStart = false
    private var scanTask: Task<Void, Never>?
    private var slowTask: Task<Void, Never>?

    var startup: MountedVolume? {
        volumes.first { $0.startup }
    }

    var current: TreeNode? {
        stack.last ?? result?.tree
    }

    var activePath: String {
        result?.root ?? pendingPath
    }

    func startIfNeeded() {
        guard !didStart else { return }
        didStart = true
        NSApplication.shared.activate()
        refreshVolumes()
        let home = NSHomeDirectory()
        pathInput = home
        scan(home)
    }

    func refreshVolumes() {
        let listed = VolumeList.list()
        volumes = listed.volumes
        volumesError = listed.error
    }

    func scan(_ rawPath: String) {
        let target = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else {
            status = .error
            error = "Choose a volume or paste a folder path."
            return
        }
        generation += 1
        let token = generation
        scanTask?.cancel()
        slowTask?.cancel()
        status = .loading
        error = nil
        slow = false
        pendingPath = target
        selection = nil
        pendingTrash = nil
        slowTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard !Task.isCancelled, let self, token == self.generation, self.status == .loading else { return }
            self.slow = true
        }
        scanTask = Task.detached { [weak self] in
            let outcome = DiskScanner.scan(path: target) { Task.isCancelled }
            await MainActor.run {
                guard let self, token == self.generation else { return }
                switch outcome {
                case .success(let next):
                    self.result = next
                    self.pathInput = next.root
                    self.pendingPath = next.root
                    self.stack = [next.tree]
                    self.hover = nil
                    self.selection = nil
                    self.pendingTrash = nil
                    self.status = .ready
                case .failure(let message):
                    self.status = .error
                    self.error = message
                case .cancelled:
                    break
                }
            }
        }
    }

    func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Scan"
        panel.message = "Choose a folder to map."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        pathInput = url.path
        scan(url.path)
    }

    var trashTarget: TreeNode? {
        guard let selection, TrashPolicy.canTrash(selection, scanRoot: result?.root) else { return nil }
        return selection
    }

    func goUp() {
        guard stack.count > 1 else { return }
        stack.removeLast()
        hover = nil
        selection = nil
    }

    /// First click selects. A second click on a selected folder opens it.
    func select(_ node: TreeNode) {
        if node.kind == .directory, selection?.id == node.id {
            stack.append(node)
            hover = nil
            selection = nil
            return
        }
        selection = node
        hover = node
    }

    func revealCrumb(at index: Int) {
        guard stack.indices.contains(index) else { return }
        stack = Array(stack.prefix(index + 1))
        hover = nil
        selection = nil
    }

    func askToTrashSelection() {
        guard let trashTarget else { return }
        pendingTrash = trashTarget
    }

    func cancelTrash() {
        pendingTrash = nil
    }

    func commitTrash() {
        guard let node = pendingTrash else { return }
        pendingTrash = nil
        let path = (node.path as NSString).standardizingPath
        guard TrashPolicy.canTrash(node, scanRoot: result?.root) else { return }
        do {
            try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
        } catch {
            trashError = "Couldn’t move \(node.name) to the Trash."
            return
        }
        guard var tree = result?.tree else { return }
        _ = removeNode(path: path, from: &tree)
        result?.tree = tree
        result?.size = tree.size
        result?.fileCount = tree.fileCount
        result?.dirCount = tree.dirCount
        rebuildStack(from: tree)
        selection = nil
        hover = nil
        DiskMonitor.shared.refresh()
    }

    private func rebuildStack(from tree: TreeNode) {
        var next = [tree]
        for crumb in stack.dropFirst() {
            guard let match = next.last?.children.first(where: { $0.path == crumb.path }) else { break }
            next.append(match)
        }
        stack = next
    }

    private func removeNode(path: String, from node: inout TreeNode) -> TreeNode? {
        if let index = node.children.firstIndex(where: { $0.path == path }) {
            let removed = node.children.remove(at: index)
            subtract(removed, from: &node)
            return removed
        }
        for index in node.children.indices {
            if let removed = removeNode(path: path, from: &node.children[index]) {
                subtract(removed, from: &node)
                return removed
            }
        }
        return nil
    }

    private func subtract(_ removed: TreeNode, from node: inout TreeNode) {
        node.size = max(0, node.size - removed.size)
        node.fileCount = max(0, node.fileCount - removed.fileCount)
        if removed.kind == .directory {
            node.dirCount = max(0, node.dirCount - 1 - removed.dirCount)
        }
    }

    func volumeIsSelected(_ volume: MountedVolume) -> Bool {
        let current = activePath
        guard !current.isEmpty else { return false }
        if volume.path == "/" {
            return current == "/"
        }
        return current == volume.path || current.hasPrefix(volume.path + "/")
    }
}
