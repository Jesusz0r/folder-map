import AppKit
import Foundation
import UserNotifications

enum FolderMapWindows {
    static var open: (() -> Void)?
}

@MainActor
final class DiskMonitor: ObservableObject {
    static let shared = DiskMonitor()

    static let choices: [(label: String, bytes: Int64)] = [
        ("Off", 0),
        ("5 GB", 5 << 30),
        ("10 GB", 10 << 30),
        ("20 GB", 20 << 30),
        ("50 GB", 50 << 30),
    ]

    @Published private(set) var freeBytes: Int64?
    @Published private(set) var thresholdBytes: Int64 = 0

    private let status = StatusBarController()
    private var timer: Timer?
    private var latched = false
    private var started = false
    private let thresholdKey = "folderMap.freeSpaceThreshold"
    private let latchKey = "folderMap.freeSpaceAlertLatched"

    private init() {}

    func start() {
        guard !started else { return }
        started = true
        thresholdBytes = Int64(UserDefaults.standard.integer(forKey: thresholdKey))
        if !Self.choices.contains(where: { $0.bytes == thresholdBytes }) {
            thresholdBytes = 0
        }
        latched = UserDefaults.standard.bool(forKey: latchKey)
        status.onClick = { DiskMonitor.shared.openApp() }
        UNUserNotificationCenter.current().delegate = NotificationPresenter.shared
        refresh()
        if thresholdBytes > 0 {
            prepareNotifications()
        }
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
            Task { @MainActor in
                DiskMonitor.shared.refresh()
            }
        }
    }

    func setThreshold(_ bytes: Int64) {
        let next = Self.choices.contains(where: { $0.bytes == bytes }) ? bytes : 0
        guard next != thresholdBytes else { return }
        thresholdBytes = next
        UserDefaults.standard.set(next, forKey: thresholdKey)
        setLatched(false)
        if next > 0 {
            prepareNotifications()
        }
        evaluateAlert()
    }

    func refresh() {
        freeBytes = VolumeList.capacity("/")?.freeBytes
        if let freeBytes {
            status.setTitle(Format.bytes(freeBytes))
            status.setToolTip("\(Format.bytes(freeBytes)) free on the startup disk. Click to open Folder Map.")
        } else {
            status.setTitle("Folder Map")
            status.setToolTip("Folder Map. Click to open.")
        }
        evaluateAlert()
    }

    func openApp() {
        NSApp.activate()
        let windows = NSApp.windows.filter { $0.canBecomeMain }
        if let window = windows.first(where: \.isVisible) ?? windows.first {
            window.makeKeyAndOrderFront(nil)
            return
        }
        FolderMapWindows.open?()
    }

    private func evaluateAlert() {
        guard thresholdBytes > 0, let freeBytes else { return }
        if freeBytes >= thresholdBytes {
            if latched { setLatched(false) }
            return
        }
        guard !latched else { return }
        setLatched(true)
        postAlert(free: freeBytes, threshold: thresholdBytes)
    }

    private func setLatched(_ value: Bool) {
        latched = value
        UserDefaults.standard.set(value, forKey: latchKey)
    }

    private func prepareNotifications() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    private func postAlert(free: Int64, threshold: Int64) {
        let content = UNMutableNotificationContent()
        content.title = "Startup disk is low on space"
        content.body = "\(Format.bytes(free)) free is below the \(Format.bytes(threshold)) mark set in Folder Map."
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

private final class StatusBarController: NSObject {
    private let item: NSStatusItem
    var onClick: (() -> Void)?

    override init() {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        let button = item.button
        button?.target = self
        button?.action = #selector(click)
        button?.image = NSImage(systemSymbolName: "internaldrive", accessibilityDescription: "Folder Map")
        button?.imagePosition = .imageLeading
        button?.toolTip = "Folder Map. Click to open."
        button?.title = "Folder Map"
    }

    func setTitle(_ title: String) {
        item.button?.title = title
    }

    func setToolTip(_ tip: String) {
        item.button?.toolTip = tip
    }

    @objc private func click() {
        onClick?()
    }
}

final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationPresenter()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

final class FolderMapDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            DiskMonitor.shared.start()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
