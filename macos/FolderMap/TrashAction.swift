import Foundation

/// What may be moved to the Trash. Only a real item inside the scanned folder,
/// and never a system location.
enum TrashPolicy {
    private static let systemPrefixes = [
        "/System",
        "/usr",
        "/bin",
        "/sbin",
        "/Library",
        "/private",
        "/dev",
        "/etc",
        "/var",
        "/opt",
        "/Applications",
        "/Volumes",
        "/cores",
    ]

    static func canTrash(_ node: TreeNode, scanRoot: String?) -> Bool {
        guard let scanRoot else { return false }
        let root = standardize(scanRoot)
        let path = standardize(node.path)
        guard path.hasPrefix("/"), path != root else { return false }
        let rootPrefix = root == "/" ? "/" : root + "/"
        guard path.hasPrefix(rootPrefix) else { return false }
        guard !isSystem(path) else { return false }
        var info = Darwin.stat()
        return Posix.lstat(path, &info) == 0
    }

    private static func standardize(_ path: String) -> String {
        (path as NSString).standardizingPath
    }

    private static func isSystem(_ path: String) -> Bool {
        if path == "/" || path == "/Users" { return true }
        return systemPrefixes.contains { path == $0 || path.hasPrefix($0 + "/") }
    }
}
