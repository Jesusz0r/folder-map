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
        if let startup {
            pathInput = startup.path
            scan(startup.path)
        } else {
            status = .error
            error = volumesError ?? "No mounted volume was found."
        }
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

    func goUp() {
        guard stack.count > 1 else { return }
        stack.removeLast()
        hover = nil
    }

    func open(_ node: TreeNode) {
        if node.kind == .directory {
            stack.append(node)
            hover = nil
            return
        }
        hover = node
    }

    func revealCrumb(at index: Int) {
        guard stack.indices.contains(index) else { return }
        stack = Array(stack.prefix(index + 1))
        hover = nil
    }

    func volumeIsSelected(_ volume: MountedVolume) -> Bool {
        let current = activePath
        guard !current.isEmpty else { return false }
        if volume.path == "/" {
            return current == "/" || (current.hasPrefix("/") && !current.hasPrefix("/Volumes"))
        }
        return current == volume.path || current.hasPrefix(volume.path + "/")
    }
}
