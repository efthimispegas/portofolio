import SwiftUI
import UIKit
import LinkPresentation
import Combine

import PortofolioNearby

final class CardActivityItem: NSObject, UIActivityItemSource {
    let url: URL
    init(url: URL) { self.url = url }
    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { url }
    func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? { url }
    func activityViewController(_ activityViewController: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String { "Portofolio synthetic card experiment" }
    func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
        let metadata = LPLinkMetadata()
        metadata.originalURL = url
        metadata.url = url
        metadata.title = "Portofolio — synthetic test card"
        if let icon = UIImage(systemName: "rectangle.stack") { metadata.iconProvider = NSItemProvider(object: icon) }
        return metadata
    }
}

struct ActivityController: UIViewControllerRepresentable {
    let url: URL
    let completion: (String) -> Void
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [CardActivityItem(url: url)], applicationActivities: nil)
        controller.completionWithItemsHandler = { activity, completed, _, error in
            completion("SENDER_CALLBACK activity=\(activity?.rawValue ?? "none") completed=\(completed) error=\(error?.localizedDescription ?? "none") recipient_receipt=unknown")
        }
        return controller
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

struct ReceiveScreen: View {
    let envelope: SyntheticNearbyEnvelope
    let decision: (Bool) -> Void
    let errorMessage: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Received through the URL handler") {
                    Text(envelope.card.name).font(.headline)
                    Text(envelope.card.category)
                    Text(envelope.card.area)
                    Text(envelope.id.uuidString).font(.caption).textSelection(.enabled)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                Section {
                    Button("Accept synthetic card") { decision(true) }
                    Button("Decline", role: .cancel) { decision(false) }
                } footer: {
                    Text("This is a separate test wallet. No contacts, Portofolio account or real professional data are changed.")
                }
            }
            .navigationTitle("Receive test card")
        }
    }
}

struct ProbeScreen: View {
    @ObservedObject var store: ProbeStore
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Native proximity experiment").font(.headline)
                    Text("Synthetic data only. The system owns any proximity animation. This screen does not simulate a successful exchange.")
                    Text("Probe 0.3 · PortofolioNearby module").font(.caption)
                }
                if let message = store.errorMessage {
                    Section("Test status") { Text(message).foregroundStyle(.red) }
                }
                Section("Sender setup") {
                    Picker("Exposure", selection: $store.mode) {
                        ForEach(ExposureMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.navigationLink)
                    Picker("Card", selection: $store.fixtureID) {
                        ForEach(SyntheticNearbyCard.fixtures) { Text($0.name).tag($0.id) }
                    }
                    Button(store.mode == .visible ? "Open baseline share sheet" : "Arm native exposure") { store.arm() }
                    if store.armedURL != nil {
                        Label("Armed — bring the two iPhone tops together", systemImage: "iphone.gen3.radiowaves.left.and.right")
                        Text("Payload expires after 5 minutes. Both phones need the test app installed.").font(.caption)
                        Button("Disarm", role: .cancel) { store.disarm("user") }
                    }
                }
                Section("Receiver") {
                    Text("On the second iPhone, leave this app open. A received payload opens a separate Accept / Decline screen. Background receipt is a separate test case.")
                    ForEach(store.accepted) { card in
                        Label("Saved: \(card.name)", systemImage: "checkmark.circle")
                    }
                }
                Section("Synthetic diagnostics") {
                    Toggle("Fail next consent save", isOn: $store.failNextSave)
                    Text("Injects one local decision-write failure; retry must succeed without duplicate cards.").font(.caption)
                }
                Section("Evidence") {
                    // An always-mounted log ShareLink competes with the card provider,
                    // including on a receiver that has not armed any card.
                    Button("View local event log") {
                        store.disarm("view_evidence")
                        store.sheet = .evidence
                    }
                    Text("Record contact relationship, device/OS, AirDrop settings and visible prompts alongside these events. A sender callback alone is not a pass.").font(.caption)
                    ForEach(store.events.suffix(12).reversed()) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.time, style: .time).font(.caption2)
                            Text(event.message).font(.caption.monospaced()).textSelection(.enabled)
                        }
                    }
                }
            }
            .navigationTitle("Portofolio Probe")
            .background {
                if let url = store.armedURL {
                    switch store.mode {
                    case .visible: EmptyView()
                    case .shareLink:
                        ExperimentalNearbyExposure(session: store.session)
                    case .embedded:
                        ActivityController(url: url) { result in Task { @MainActor in store.record(result) } }
                            .id(url)
                            .opacity(0)
                            .allowsHitTesting(false)
                    }
                }
            }
            .task(id: store.session.armed?.id) {
                guard let offer = store.session.armed else { return }
                let remaining = max(0, offer.issuedAt.addingTimeInterval(300).timeIntervalSinceNow)
                do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
                store.expire(id: offer.id)
            }
            .onChange(of: store.mode) { _, _ in store.disarm("mode_changed") }
            .onChange(of: store.fixtureID) { _, _ in store.disarm("fixture_changed") }
            .sheet(item: $store.sheet, onDismiss: store.sheetDismissed) { sheet in
                switch sheet {
                case .share(let url):
                    ActivityController(url: url) { result in Task { @MainActor in store.record(result) } }
                case .receive(let envelope):
                    ReceiveScreen(envelope: envelope, decision: { store.decide(envelope, accept: $0) }, errorMessage: store.errorMessage)
                case .evidence:
                    NavigationStack {
                        ScrollView {
                            Text(store.exportLog)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .padding()
                        }
                        .navigationTitle("Local event log")
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { store.sheet = nil }
                            }
                        }
                    }
                }
            }
        }
    }
}

@MainActor
final class ProbeBootstrap: ObservableObject {
    let store: ProbeStore?
    let error: String?
    init() {
        do {
            store = try ProbeStore(directory: .documentsDirectory, runtime: "\(UIDevice.current.model) iOS \(UIDevice.current.systemVersion)")
            error = nil
        } catch {
            store = nil
            self.error = "Probe evidence could not be loaded. Existing files have been preserved. Investigate the evidence file before retrying."
        }
    }
}

@main
struct PortofolioProbeApp: App {
    @StateObject private var bootstrap = ProbeBootstrap()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group {
                if let store = bootstrap.store { ProbeScreen(store: store) }
                else { ContentUnavailableView("Probe storage unavailable", systemImage: "exclamationmark.triangle", description: Text(bootstrap.error ?? "")) }
            }
            .onOpenURL { bootstrap.store?.receive($0) }
            .onChange(of: phase) { _, value in
                bootstrap.store?.record("SCENE \(String(describing: value))")
                if value == .background { bootstrap.store?.disarm("background") }
            }
        }
    }
}
