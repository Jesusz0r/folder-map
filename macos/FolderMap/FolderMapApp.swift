import SwiftUI

@main
struct FolderMapApp: App {
    @NSApplicationDelegateAdaptor(FolderMapDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup(id: "main") {
            ContentView()
                .frame(minWidth: 980, minHeight: 680)
                .background(WindowBridge())
        }
        .defaultSize(width: 1180, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}

private struct WindowBridge: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Color.clear
            .onAppear {
                FolderMapWindows.open = { openWindow(id: "main") }
            }
    }
}
