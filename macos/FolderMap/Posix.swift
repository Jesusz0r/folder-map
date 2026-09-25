import Darwin
import Foundation

// Swift imports the C `stat` struct under the same name as the function, so the function is not callable.

@_silgen_name("stat")
private func cStat(_ path: UnsafePointer<CChar>, _ buf: UnsafeMutablePointer<Darwin.stat>) -> Int32

@_silgen_name("lstat")
private func cLstat(_ path: UnsafePointer<CChar>, _ buf: UnsafeMutablePointer<Darwin.stat>) -> Int32

@_silgen_name("statfs")
private func cStatfs(_ path: UnsafePointer<CChar>, _ buf: UnsafeMutablePointer<Darwin.statfs>) -> Int32

enum Posix {
    static func stat(_ path: String, _ info: inout Darwin.stat) -> Int32 {
        path.withCString { cStat($0, &info) }
    }

    static func lstat(_ path: String, _ info: inout Darwin.stat) -> Int32 {
        path.withCString { cLstat($0, &info) }
    }

    static func statfs(_ path: String, _ info: inout Darwin.statfs) -> Int32 {
        path.withCString { cStatfs($0, &info) }
    }

    static func realPath(_ path: String) -> String? {
        guard let raw = path.withCString({ Darwin.realpath($0, nil) }) else { return nil }
        defer { free(raw) }
        return String(cString: raw)
    }
}
