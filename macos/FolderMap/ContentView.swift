import AppKit
import SwiftUI

struct ContentView: View {
    @StateObject private var model = FolderMapModel()
    private static var didInstallKeys = false

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 360)
        } detail: {
            detail
        }
        .navigationTitle("Folder Map")
        .onAppear {
            model.startIfNeeded()
            installKeyMonitor()
        }
    }

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                volumeSection
                folderSection
                summarySection
                largestSection
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var volumeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Volumes on this Mac")
                    .font(.headline)
                Spacer()
                Button("Refresh") { model.refreshVolumes() }
                    .controlSize(.small)
            }
            if let volumesError = model.volumesError {
                Text(volumesError)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if model.volumes.isEmpty {
                Text("No mounted volumes were found.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.volumes) { volume in
                    Button {
                        model.pathInput = volume.path
                        model.scan(volume.path)
                    } label: {
                        HStack {
                            Image(systemName: volume.startup ? "internaldrive" : "externaldrive")
                            VStack(alignment: .leading, spacing: 2) {
                                Text(volume.name)
                                if volume.startup {
                                    Text("Startup")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(model.volumeIsSelected(volume) ? Color.accentColor.opacity(0.18) : Color.clear)
                    )
                    .accessibilityLabel(volume.startup ? "\(volume.name), Startup" : volume.name)
                }
            }
        }
    }

    private var folderSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Or scan another folder")
                .font(.headline)
            TextField("Folder path", text: $model.pathInput)
                .textFieldStyle(.roundedBorder)
                .font(.body.monospaced())
                .onSubmit { model.scan(model.pathInput) }
            HStack {
                Button("Scan") { model.scan(model.pathInput) }
                Button("Choose Folder…") { model.chooseFolder() }
            }
        }
    }

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("This scan")
                .font(.headline)
            if let result = model.result, let current = model.current {
                Text(result.root)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .accessibilityIdentifier("scan-root")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading) {
                    stat("This folder", Format.bytes(current.size))
                    stat("Whole scan", Format.bytes(result.size))
                    stat("Files", Format.count(current.fileCount))
                    stat("Folders", Format.count(current.dirCount))
                }
                if let volume = result.volume {
                    Text("\(Format.percent(part: volume.freeBytes, whole: volume.totalBytes)) of this volume is free (\(Format.bytes(volume.freeBytes)) of \(Format.bytes(volume.totalBytes))).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Free space for this volume isn’t available.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text("Scanned in \(Format.count(result.elapsedMs)) ms")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text(model.status == .loading ? "Reading file sizes…" : "Waiting for a scan")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var largestSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Largest here")
                .font(.headline)
            let nodes = model.current?.children.filter { $0.size > 0 }.prefix(8) ?? []
            if nodes.isEmpty {
                Text(model.current == nil ? "Waiting for a scan" : "No sized items in this folder.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(nodes)) { node in
                    Button {
                        model.open(node)
                    } label: {
                        HStack {
                            Image(systemName: icon(for: node.kind))
                                .foregroundStyle(.secondary)
                            Text(node.name)
                                .lineLimit(1)
                            Spacer()
                            Text(Format.bytes(node.size))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(node.name), \(node.path)")
                }
            }
        }
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 12) {
            toolbar
            map
            focusLine
            footer
            notices
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button {
                model.goUp()
            } label: {
                Label("Up", systemImage: "arrow.up")
            }
            .disabled((model.stack.count) <= 1)
            .help("Up one folder")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(Array(model.stack.enumerated()), id: \.offset) { index, crumb in
                        if index > 0 {
                            Text("/")
                                .foregroundStyle(.secondary)
                        }
                        Button(crumb.name) {
                            model.revealCrumb(at: index)
                        }
                        .buttonStyle(.plain)
                        .disabled(index == model.stack.count - 1)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var map: some View {
        let blocks = model.current.map { Squarify.visibleChildren($0) } ?? []
        ZStack {
            if model.status == .loading && model.result == nil {
                loadingMap
            } else if let current = model.current, !blocks.isEmpty {
                TreemapView(
                    nodes: blocks,
                    parentSize: current.size,
                    activeID: (model.hover ?? blocks.first)?.id,
                    onOpen: { model.open($0) },
                    onHover: { model.hover = $0 }
                )
            } else if let current = model.current {
                emptyFolder(current)
            } else {
                loadingMap
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var loadingMap: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(loadingTitle)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(hex: 0x1E1E2E))
    }

    private var loadingTitle: String {
        let label = loadingLabel
        if model.slow {
            return "Still reading \(label). A large folder can take a minute or two."
        }
        return "Reading \(label)…"
    }

    private func emptyFolder(_ node: TreeNode) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "folder")
                .font(.title)
                .foregroundStyle(.secondary)
            Text("Nothing in \(node.name) has a size")
                .font(.headline)
            Text(node.error ?? "This folder has no files or subfolders with a size.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if model.stack.count > 1 {
                Button("Up one folder") { model.goUp() }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(hex: 0x1E1E2E))
    }

    private var focusLine: some View {
        let blocks = model.current.map { Squarify.visibleChildren($0) } ?? []
        let focus = model.hover ?? blocks.first
        return VStack(alignment: .leading, spacing: 2) {
            if let focus, let current = model.current {
                Text("\(focus.name)  \(Format.bytes(focus.size)) · \(Format.percent(part: focus.size, whole: current.size)) of this folder")
                    .font(.callout)
                    .lineLimit(1)
                Text(focus.path.isEmpty ? "Smaller items grouped from this folder" : focus.path)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("focus-path")
            } else {
                Text("Hover a block for its size and path. Click a folder to open it.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 36)
    }

    private var footer: some View {
        HStack {
            Text(model.result?.name ?? "—")
            Spacer()
            if let current = model.current {
                Text("\(Format.bytes(current.size)) in this folder · \(Format.count(current.fileCount)) files")
            } else {
                Text("Waiting for a scan")
            }
            Spacer()
            if let volume = model.result?.volume {
                Text("\(Format.bytes(volume.totalBytes - volume.freeBytes)) used of \(Format.bytes(volume.totalBytes)) · \(Format.percent(part: volume.freeBytes, whole: volume.totalBytes)) free")
            } else {
                Text("Volume size unavailable")
            }
        }
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
    }

    private var notices: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.status == .loading {
                Text(model.slow
                    ? "Still reading. A large folder can take a minute or two. File names and sizes stay on this Mac."
                    : "File names and sizes stay on this Mac.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let message = model.error {
                notice(title: "Couldn’t scan that folder", message: message)
                Button("Scan Home") {
                    let home = NSHomeDirectory()
                    model.pathInput = home
                    model.scan(home)
                }
            }
            if model.result?.truncated == true {
                notice(
                    title: "This scan is partial",
                    message: "The scan stopped before every folder was measured. Blocks already measured are the ones to trust. Choose a smaller folder to read it completely."
                )
            }
            if let result = model.result, result.skipped > 0 {
                Text("Some folders were skipped because this Mac would not open them.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("skipped-note")
            }
        }
    }

    private var loadingLabel: String {
        let pending = model.pendingPath
        if pending.isEmpty { return "this folder" }
        if let volume = model.volumes.first(where: { $0.path == pending }) {
            return volume.name
        }
        return pending
    }

    private func notice(title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.12)))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.body.monospacedDigit())
        }
    }

    private func icon(for kind: NodeKind) -> String {
        switch kind {
        case .directory: return "folder"
        case .symlink: return "link"
        case .file: return "doc"
        }
    }

    private func installKeyMonitor() {
        guard !Self.didInstallKeys else { return }
        Self.didInstallKeys = true
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let isEscape = event.keyCode == 53
            let isDelete = event.keyCode == 51 && flags.isEmpty
            guard isEscape || isDelete else { return event }
            if NSApp.keyWindow?.firstResponder is NSTextView { return event }
            model.goUp()
            return nil
        }
    }
}
