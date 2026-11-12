// OneDrive Manager — native macOS shell.
//
// A tiny AppKit + WKWebView wrapper around the Next.js app. On launch it reuses a server
// already listening on its port (e.g. `npm run dev`), otherwise it starts the production
// server (`next start`) itself and stops it again on quit. Config (project dir, node path)
// is baked into Info.plist by mac/build-app.sh;
// the port comes from AZURE_REDIRECT_URI in .env.
//
// Closing the window keeps the app (and any transfer) running: it leaves the Dock and lives
// in the menu bar. Click the menu-bar icon to reopen; right-click it to quit.

import Cocoa
import WebKit

let port = Bundle.main.infoDictionary?["ODMPort"] as? Int ?? 3417
let appURL = URL(string: "http://localhost:\(port)/")!  // must match AZURE_REDIRECT_URI's host
let probeURL = URL(string: "http://127.0.0.1:\(port)/api/moves")!
// `localhost` may resolve to IPv6 first, so a foreign server on [::1]:<port> would hijack the window.
let probeHosts = ["127.0.0.1", "[::1]"]

enum PortState { case ours, foreign, free }

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var status: NSTextField!
    var server: Process?  // non-nil only if we started it
    var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()
        buildStatusItem()
        Task { await start() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    // Dock icon / Finder re-open while the window is hidden.
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showWindow(nil); return false
    }

    // MARK: Menu-bar mode

    func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = statusItem.button else { return }
        let img = NSImage(systemSymbolName: "icloud", accessibilityDescription: "OneDrive Manager")
        img?.isTemplate = true
        button.image = img
        button.toolTip = "OneDrive Manager"
        button.target = self
        button.action = #selector(statusItemClicked(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc func statusItemClicked(_ sender: Any?) {
        let e = NSApp.currentEvent
        let isRight = e?.type == .rightMouseUp || e?.modifierFlags.contains(.control) == true
        guard isRight else { return showWindow(nil) }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open OneDrive Manager", action: #selector(showWindow(_:)), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit OneDrive Manager", action: #selector(quitFromMenuBar(_:)), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        statusItem.menu = menu
        statusItem.button?.performClick(nil)  // pops the menu
        statusItem.menu = nil                 // so left-click keeps opening the window
    }

    @objc func showWindow(_ sender: Any?) {
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func quitFromMenuBar(_ sender: Any?) {
        NSApp.activate(ignoringOtherApps: true)  // so the "move in progress" alert is in front
        NSApp.terminate(nil)
    }

    // Window closed → drop out of the Dock; server and transfers keep running.
    func windowWillClose(_ note: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }

    // MARK: Server lifecycle

    func start() async {
        switch await portState() {
        case .ours: return load()
        case .foreign: return fail("Port \(port) is in use by another app. Quit it, then reopen OneDrive Manager.\n(Microsoft sign-in is registered to localhost:\(port), so the port can't change.)")
        case .free: break
        }
        do { try launchServer() } catch { return fail("Couldn't start the server: \(error.localizedDescription)") }
        for _ in 0..<120 {  // ~30s
            try? await Task.sleep(nanoseconds: 250_000_000)
            if server?.isRunning == false { return fail("The server exited during startup. See ~/Library/Logs/OneDriveManager.log") }
            if await probe("127.0.0.1") == .ours { return load() }
        }
        fail("The server didn't respond within 30s. See ~/Library/Logs/OneDriveManager.log")
    }

    func portState() async -> PortState {
        var sawFree = true
        for host in probeHosts {
            switch await probe(host) {
            case .ours: return .ours
            case .foreign: sawFree = false
            case .free: break
            }
        }
        return sawFree ? .free : .foreign
    }

    /// Ours = `/api/moves` answers with `{"moves": [...]}` (this app's shape).
    func probe(_ host: String) async -> PortState {
        var req = URLRequest(url: URL(string: "http://\(host):\(port)/api/moves")!); req.timeoutInterval = 1
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return .free }
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["moves"] is [Any] ? .ours : .foreign
    }

    func launchServer() throws {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let dir = info["ODMProjectDir"] as? String, let node = info["ODMNodePath"] as? String else {
            throw NSError(domain: "ODM", code: 1, userInfo: [NSLocalizedDescriptionKey: "Info.plist missing ODMProjectDir/ODMNodePath"])
        }
        guard FileManager.default.fileExists(atPath: dir + "/.next/BUILD_ID") else {
            throw NSError(domain: "ODM", code: 2, userInfo: [NSLocalizedDescriptionKey: "No production build. Run mac/build-app.sh."])
        }
        let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/OneDriveManager.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try FileHandle(forWritingTo: logURL)

        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [dir + "/node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)]
        p.currentDirectoryURL = URL(fileURLWithPath: dir)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = (node as NSString).deletingLastPathComponent + ":/usr/bin:/bin"
        env["NODE_ENV"] = "production"
        p.environment = env
        p.standardOutput = log
        p.standardError = log
        try p.run()
        server = p
    }

    func load() {
        status.isHidden = true
        webView.isHidden = false
        webView.load(URLRequest(url: appURL))
    }

    func fail(_ msg: String) {
        status.stringValue = msg
    }

    // Quitting pauses an in-flight move (it auto-resumes on next launch) — say so first.
    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        guard server != nil else { return .terminateNow }
        Task {
            let busy = await moveInProgress()
            do {
                if busy {
                    let a = NSAlert()
                    a.messageText = "A move is in progress"
                    a.informativeText = "Quitting pauses it. It resumes automatically next time you open OneDrive Manager.\n\nTo keep it running in the background, just close the window instead."
                    a.addButton(withTitle: "Keep Running")
                    a.addButton(withTitle: "Quit Anyway")
                    if a.runModal() == .alertFirstButtonReturn { return app.reply(toApplicationShouldTerminate: false) }
                }
                app.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ note: Notification) {
        guard let p = server, p.isRunning else { return }
        p.terminate()
        p.waitUntilExit()
    }

    func moveInProgress() async -> Bool {
        guard let (data, _) = try? await URLSession.shared.data(from: probeURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let moves = json["moves"] as? [[String: Any]] else { return false }
        let active: Set<String> = ["copying", "verifying", "deleting"]
        return moves.contains { active.contains($0["status"] as? String ?? "") }
    }

    // MARK: UI

    func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "OneDrive Manager"
        window.isReleasedWhenClosed = false  // closing only hides it (menu-bar mode)
        window.delegate = self
        window.minSize = NSSize(width: 720, height: 480)
        window.center()
        window.setFrameAutosaveName("MainWindow")

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()  // persist cookies between launches
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isHidden = true

        status = NSTextField(labelWithString: "Starting…")
        status.alignment = .center
        status.textColor = .secondaryLabelColor
        status.lineBreakMode = .byWordWrapping
        status.maximumNumberOfLines = 0

        let root = NSView()
        for v in [webView!, status!] as [NSView] { v.translatesAutoresizingMaskIntoConstraints = false; root.addSubview(v) }
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor), webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: root.topAnchor), webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            status.centerXAnchor.constraint(equalTo: root.centerXAnchor), status.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            status.widthAnchor.constraint(lessThanOrEqualTo: root.widthAnchor, constant: -64),
        ])
        window.contentView = root
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // target=_blank links (e.g. Microsoft account settings) open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    @objc func reload(_ sender: Any?) { webView.reload() }
    @objc func goHome(_ sender: Any?) { webView.load(URLRequest(url: appURL)) }
    @objc func goBack(_ sender: Any?) { webView.goBack() }

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let m = NSMenu(title: title); items.forEach(m.addItem)
            let host = NSMenuItem(); host.submenu = m; main.addItem(host)
        }
        add("OneDrive Manager", [
            NSMenuItem(title: "Hide OneDrive Manager", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"),
            .separator(),
            NSMenuItem(title: "Quit OneDrive Manager", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"),
        ])
        add("Edit", [
            NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"),
            NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"),
            .separator(),
            NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
            NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
            NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
            NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
        ])
        add("View", [
            NSMenuItem(title: "Overview", action: #selector(goHome(_:)), keyEquivalent: "1"),
            NSMenuItem(title: "Back", action: #selector(goBack(_:)), keyEquivalent: "["),
            NSMenuItem(title: "Reload", action: #selector(reload(_:)), keyEquivalent: "r"),
        ])
        add("Window", [
            NSMenuItem(title: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"),
            NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"),
        ])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
