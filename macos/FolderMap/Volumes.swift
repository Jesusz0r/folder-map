import Darwin
import Foundation

enum VolumeList {
    /// `/Volumes/<startup>` is a symlink to `/` on macOS. List that disk once,
    /// under the name from `/Volumes`, and scan `/` so paths stay on the startup disk.
    static func assemble(_ mounts: [VolumeMount]) -> [MountedVolume] {
        let startupMount = mounts.first { $0.realPath == "/" }
        let startup = MountedVolume(
            id: "startup",
            name: startupMount?.name ?? "Startup disk",
            path: "/",
            startup: true,
            totalBytes: startupMount?.totalBytes,
            freeBytes: startupMount?.freeBytes
        )
        let others = mounts
            .filter { $0.realPath != "/" }
            .map { mount in
                MountedVolume(
                    id: mount.mountPath,
                    name: mount.name,
                    path: mount.mountPath,
                    startup: false,
                    totalBytes: mount.totalBytes,
                    freeBytes: mount.freeBytes
                )
            }
            .sorted { lhs, rhs in
                let name = lhs.name.localizedCompare(rhs.name)
                if name != .orderedSame { return name == .orderedAscending }
                return lhs.path.localizedCompare(rhs.path) == .orderedAscending
            }
        return [startup] + others
    }

    static func list() -> (volumes: [MountedVolume], error: String?) {
        var mounts: [VolumeMount] = []
        var error: String?
        let rootCapacity = capacity("/")

        do {
            let entries = try FileManager.default.contentsOfDirectory(atPath: "/Volumes")
            for name in entries {
                let mountPath = "/Volumes/\(name)"
                guard isDirectoryOrLink(mountPath) else { continue }
                guard isDirectory(mountPath) else { continue }
                let resolved = Posix.realPath(mountPath) ?? mountPath
                let stats = resolved == "/" ? rootCapacity : capacity(mountPath)
                mounts.append(
                    VolumeMount(
                        name: name,
                        realPath: resolved,
                        mountPath: mountPath,
                        totalBytes: stats?.totalBytes,
                        freeBytes: stats?.freeBytes
                    )
                )
            }
        } catch let caught {
            let denied = isPermission(caught)
            error = denied
                ? "Permission denied while reading other disks. The startup disk is still listed."
                : "Other disks could not be listed. The startup disk is still listed."
        }

        if !mounts.contains(where: { $0.realPath == "/" }) {
            mounts.insert(
                VolumeMount(
                    name: "Startup disk",
                    realPath: "/",
                    mountPath: "/",
                    totalBytes: rootCapacity?.totalBytes,
                    freeBytes: rootCapacity?.freeBytes
                ),
                at: 0
            )
        }

        return (assemble(mounts), error)
    }

    static func capacity(_ path: String) -> VolumeInfo? {
        var info = Darwin.statfs()
        guard Posix.statfs(path, &info) == 0 else { return nil }
        let block = UInt64(info.f_bsize)
        let total = info.f_blocks * block
        let free = info.f_bavail * block
        guard total <= UInt64(Int64.max), free <= UInt64(Int64.max) else { return nil }
        return VolumeInfo(totalBytes: Int64(total), freeBytes: Int64(free))
    }

    private static func isDirectoryOrLink(_ path: String) -> Bool {
        var info = Darwin.stat()
        guard Posix.lstat(path, &info) == 0 else { return false }
        let kind = info.st_mode & S_IFMT
        return kind == S_IFDIR || kind == S_IFLNK
    }

    private static func isDirectory(_ path: String) -> Bool {
        var info = Darwin.stat()
        guard Posix.stat(path, &info) == 0 else { return false }
        return (info.st_mode & S_IFMT) == S_IFDIR
    }

    private static func isPermission(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == NSPOSIXErrorDomain {
            return ns.code == Int(EACCES) || ns.code == Int(EPERM)
        }
        return ns.code == NSFileReadNoPermissionError
    }
}
