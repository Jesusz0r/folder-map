import Foundation

enum Format {
    static func bytes(_ bytes: Int64) -> String {
        guard bytes >= 0 else { return "—" }
        if bytes < 1024 { return "\(bytes) B" }
        let units = ["KB", "MB", "GB", "TB", "PB"]
        var value = Double(bytes) / 1024
        var unit = 0
        while value >= 1024 && unit < units.count - 1 {
            value /= 1024
            unit += 1
        }
        let digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
        return "\(String(format: "%.\(digits)f", value)) \(units[unit])"
    }

    static func percent(part: Int64, whole: Int64) -> String {
        guard part >= 0, whole > 0 else { return "0%" }
        let pct = (Double(part) / Double(whole)) * 100
        if pct > 0 && pct < 0.1 { return "<0.1%" }
        if pct >= 10 { return "\(Int(pct.rounded()))%" }
        return String(format: "%.1f%%", pct)
    }

    static func count(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}
