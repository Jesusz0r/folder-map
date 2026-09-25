import Foundation

enum NodeKind {
    case file
    case directory
    case symlink
}

struct TreeNode: Identifiable {
    var name: String
    var path: String
    var kind: NodeKind
    var size: Int64
    var fileCount: Int
    var dirCount: Int
    var children: [TreeNode]
    var error: String?

    var id: String { path.isEmpty ? name : path }
}

struct VolumeInfo {
    var totalBytes: Int64
    var freeBytes: Int64
}

struct ScanResult {
    var root: String
    var name: String
    var size: Int64
    var fileCount: Int
    var dirCount: Int
    /// Folders the system would not open. They are left out of the map.
    var skipped: Int
    var truncated: Bool
    var elapsedMs: Int
    var volume: VolumeInfo?
    var tree: TreeNode
}

struct MountedVolume: Identifiable {
    var id: String
    var name: String
    var path: String
    var startup: Bool
    var totalBytes: Int64?
    var freeBytes: Int64?
}

struct VolumeMount {
    var name: String
    /// Canonical path after resolving links. `/` is the startup disk.
    var realPath: String
    /// Path the user sees and the scanner opens.
    var mountPath: String
    var totalBytes: Int64?
    var freeBytes: Int64?
}

enum LoadState {
    case loading
    case ready
    case error
}

enum ScanOutcome {
    case success(ScanResult)
    case failure(String)
    case cancelled
}
