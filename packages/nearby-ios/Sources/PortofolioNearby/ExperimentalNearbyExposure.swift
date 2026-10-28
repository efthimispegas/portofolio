#if os(iOS)
import SwiftUI

/// Mount once, only inside the active synthetic sharing flow.
/// Reuses the probe's hidden ShareLink composition; participation in proximity is experimental.
/// This does not implement or customize NameDrop, or acknowledge a remote save.
@available(iOS 26.0, *)
public struct ExperimentalNearbyExposure: View {
    @ObservedObject private var session: SyntheticNearbySession
    @Environment(\.scenePhase) private var scenePhase

    public init(session: SyntheticNearbySession) { self.session = session }

    public var body: some View {
        Group {
            if let offer = session.armed,
               let url = try? SyntheticNearbyCodec.url(for: offer) {
                ShareLink(item: url, preview: SharePreview("Portofolio synthetic card")) {
                    Text("Experimental provider")
                }
                .id(offer.id)
                .hidden()
                .accessibilityHidden(true)
                .allowsHitTesting(false)
            }
        }
        .task(id: session.armed?.id) {
            guard let offer = session.armed else { return }
            let remaining = max(0, offer.issuedAt.addingTimeInterval(300).timeIntervalSinceNow)
            do { try await Task.sleep(for: .seconds(remaining)) }
            catch { return }
            session.expireOffer(id: offer.id)
        }
        .onChange(of: scenePhase) { _, phase in
            // Inactive can mean the system sharing UI. Removing its provider then breaks the handoff.
            if phase == .background { session.disarm() }
        }
        .onDisappear { session.disarm() }
    }
}
#endif
