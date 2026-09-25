import SwiftUI

struct TreemapView: View {
    var nodes: [TreeNode]
    var parentSize: Int64
    var activeID: String?
    var onOpen: (TreeNode) -> Void
    var onHover: (TreeNode?) -> Void

    private let palette: [(Color, Color)] = [
        (Color(hex: 0x3B4B7A), Color(hex: 0x2A3560)),
        (Color(hex: 0x2A5A5A), Color(hex: 0x1E4040)),
        (Color(hex: 0x4A3060), Color(hex: 0x2E1E40)),
        (Color(hex: 0x5A3A2A), Color(hex: 0x3D2518)),
        (Color(hex: 0x4A2A3A), Color(hex: 0x2E1825)),
        (Color(hex: 0x2A4A3A), Color(hex: 0x1A3028)),
        (Color(hex: 0x3A3A50), Color(hex: 0x252535)),
        (Color(hex: 0x3D4E6A), Color(hex: 0x28344A)),
        (Color(hex: 0x4E3D55), Color(hex: 0x322838)),
        (Color(hex: 0x3E4A3A), Color(hex: 0x283228)),
    ]

    var body: some View {
        GeometryReader { geo in
            let rects = Squarify.layout(
                nodes.map(\.size),
                in: MapRect(x: 0, y: 0, w: geo.size.width, h: geo.size.height)
            )
            ZStack(alignment: .topLeading) {
                ForEach(Array(nodes.enumerated()), id: \.element.id) { index, node in
                    let rect = rects[index]
                    if rect.w > 4, rect.h > 4 {
                        block(node, rect: rect, index: index)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .background(Color(hex: 0x1E1E2E))
    }

    private func block(_ node: TreeNode, rect: MapRect, index: Int) -> some View {
        let gap: Double = rect.w > 36 && rect.h > 28 ? 4 : 2
        let width = max(0, rect.w - gap)
        let height = max(0, rect.h - gap)
        let colors = palette[index % palette.count]
        let selected = activeID == node.id
        return Button {
            onOpen(node)
        } label: {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(colors: [colors.0, colors.1], startPoint: .topLeading, endPoint: .bottomTrailing)
                if width > 72 && height > 36 {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(node.name)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        if height > 64 {
                            Text(Format.bytes(node.size))
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.white.opacity(0.75))
                                .lineLimit(1)
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(8)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                }
            }
            .frame(width: width, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay {
                if selected {
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(.white.opacity(0.85), lineWidth: 2)
                }
            }
        }
        .buttonStyle(.plain)
        .position(x: rect.x + rect.w / 2, y: rect.y + rect.h / 2)
        .onHover { hovering in
            onHover(hovering ? node : nil)
        }
        .accessibilityLabel("\(node.name), \(Format.bytes(node.size)), \(node.path.isEmpty ? "grouped items" : node.path)")
        .help(node.path.isEmpty ? node.name : node.path)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
