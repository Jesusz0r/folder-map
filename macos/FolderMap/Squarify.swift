import Foundation

struct MapRect {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

private struct RowItem {
    var index: Int
    var area: Double
}

enum Squarify {
    static func layout(_ sizes: [Int64], in bounds: MapRect) -> [MapRect] {
        var rects = Array(repeating: MapRect(x: bounds.x, y: bounds.y, w: 0, h: 0), count: sizes.count)
        guard bounds.w > 0, bounds.h > 0 else { return rects }

        let total = sizes.reduce(Int64(0)) { $0 + ($1 > 0 ? $1 : 0) }
        guard total > 0 else { return rects }

        let area = bounds.w * bounds.h
        var items: [RowItem] = []
        for index in sizes.indices {
            let size = sizes[index]
            if size > 0 {
                items.append(RowItem(index: index, area: (Double(size) / Double(total)) * area))
            }
        }

        var remaining = bounds
        var row: [RowItem] = []
        for item in items {
            let side = min(remaining.w, remaining.h)
            if row.isEmpty || worst(row + [item], side: side) <= worst(row, side: side) {
                row.append(item)
                continue
            }
            remaining = placeRow(row, bounds: remaining, rects: &rects)
            row = [item]
        }
        if !row.isEmpty {
            _ = placeRow(row, bounds: remaining, rects: &rects)
        }
        return rects
    }

    /// Largest entries for the map. The tail is grouped so small files stay readable.
    static func visibleChildren(_ node: TreeNode) -> [TreeNode] {
        let sized = node.children.filter { $0.size > 0 }
        if sized.count <= 16 { return sized }
        let head = Array(sized.prefix(15))
        let rest = Array(sized.dropFirst(15))
        let other = TreeNode(
            name: "Other (\(rest.count))",
            path: "",
            kind: .directory,
            size: rest.reduce(0) { $0 + $1.size },
            fileCount: rest.reduce(0) { $0 + $1.fileCount },
            dirCount: rest.reduce(0) { sum, child in
                sum + (child.kind == .directory ? 1 + child.dirCount : 0)
            },
            children: rest,
            error: nil
        )
        return head + [other]
    }

    private static func worst(_ row: [RowItem], side: Double) -> Double {
        guard !row.isEmpty, side > 0 else { return .infinity }
        var sum = 0.0
        var minArea = Double.infinity
        var maxArea = 0.0
        for item in row {
            sum += item.area
            minArea = min(minArea, item.area)
            maxArea = max(maxArea, item.area)
        }
        guard minArea > 0, sum > 0 else { return .infinity }
        let sum2 = sum * sum
        let side2 = side * side
        return max((side2 * maxArea) / sum2, sum2 / (side2 * minArea))
    }

    private static func placeRow(_ row: [RowItem], bounds: MapRect, rects: inout [MapRect]) -> MapRect {
        let rowArea = row.reduce(0) { $0 + $1.area }
        if bounds.w >= bounds.h {
            let rowWidth = bounds.h > 0 ? rowArea / bounds.h : 0
            var y = bounds.y
            for item in row {
                let height = rowWidth > 0 ? item.area / rowWidth : 0
                rects[item.index] = MapRect(x: bounds.x, y: y, w: rowWidth, h: height)
                y += height
            }
            return MapRect(
                x: bounds.x + rowWidth,
                y: bounds.y,
                w: max(0, bounds.w - rowWidth),
                h: bounds.h
            )
        }

        let rowHeight = bounds.w > 0 ? rowArea / bounds.w : 0
        var x = bounds.x
        for item in row {
            let width = rowHeight > 0 ? item.area / rowHeight : 0
            rects[item.index] = MapRect(x: x, y: bounds.y, w: width, h: rowHeight)
            x += width
        }
        return MapRect(
            x: bounds.x,
            y: bounds.y + rowHeight,
            w: bounds.w,
            h: max(0, bounds.h - rowHeight)
        )
    }
}
