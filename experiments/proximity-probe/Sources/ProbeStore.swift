import Foundation
import Combine
import PortofolioNearby

enum ExposureMode: String, CaseIterable, Identifiable {
    case visible = "Visible share sheet — baseline"
    case shareLink = "Hidden ShareLink — experiment"
    case embedded = "Embedded activity controller — experiment"
    var id: String { rawValue }
}

struct ProbeEvent: Codable, Identifiable {
    var id = UUID()
    var time = Date()
    let message: String
}

struct HarnessSnapshot: Codable {
    var version = 3
    var events: [ProbeEvent]
    var state: SyntheticNearbySnapshot
}

enum ProbeSheet: Identifiable {
    case share(URL)
    case receive(SyntheticNearbyEnvelope)
    case evidence
    var id: String {
        switch self {
        case .share(let url): return "share-" + url.absoluteString
        case .receive(let envelope): return "receive-" + envelope.id.uuidString
        case .evidence: return "evidence"
        }
    }
}

enum HarnessError: Error { case unsupportedSnapshot, simulatedWriteFailure }

@MainActor
final class HarnessDisk {
    let url: URL
    var value: HarnessSnapshot
    var failNextDecision = false

    init(directory: URL) throws {
        url = directory.appendingPathComponent("probe-v03-evidence.json")
        if FileManager.default.fileExists(atPath: url.path) {
            value = try JSONDecoder().decode(HarnessSnapshot.self, from: Data(contentsOf: url))
            guard value.version == 3 else { throw HarnessError.unsupportedSnapshot }
        } else {
            value = HarnessSnapshot(events: [], state: .init())
        }
    }

    func save(_ next: HarnessSnapshot) throws {
        try JSONEncoder().encode(next).write(to: url, options: [.atomic, .completeFileProtection])
        value = next
    }

    func commit(_ state: SyntheticNearbySnapshot) throws {
        if failNextDecision {
            failNextDecision = false
            throw HarnessError.simulatedWriteFailure
        }
        var next = value
        next.state = state
        try save(next)
    }
}

@MainActor
final class ProbeStore: ObservableObject {
    @Published var mode = ExposureMode.visible
    @Published var fixtureID = SyntheticNearbyCard.electrician.id
    @Published var sheet: ProbeSheet?
    @Published var errorMessage: String?
    @Published var failNextSave = false
    @Published private(set) var events: [ProbeEvent]
    let session: SyntheticNearbySession
    private let disk: HarnessDisk
    private var observation: AnyCancellable?

    init(directory: URL, runtime: String = "host-test") throws {
        let storage = try HarnessDisk(directory: directory)
        disk = storage
        events = storage.value.events
        session = try SyntheticNearbySession(restored: storage.value.state) { try storage.commit($0) }
        observation = session.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
        record("LAUNCH app=0.3 build=3 module=PortofolioNearby synthetic_only=true runtime=\(runtime)")
    }

    var accepted: [SyntheticNearbyCard] { session.snapshot.cards }
    var armedURL: URL? { session.armed.flatMap { try? SyntheticNearbyCodec.url(for: $0) } }

    func record(_ message: String) {
        var next = disk.value
        next.events = Array((events + [ProbeEvent(message: message)]).suffix(500))
        do {
            try disk.save(next)
            events = next.events
        } catch {
            errorMessage = "Evidence could not be written. This run is not fully recorded."
            events = Array((events + [ProbeEvent(message: "EVIDENCE_WRITE_FAILED")]).suffix(500))
        }
    }

    func arm(now: Date = Date()) {
        guard let card = SyntheticNearbyCard.fixtures.first(where: { $0.id == fixtureID }) else { return }
        do {
            try session.arm(card, now: now)
            guard let offer = session.armed, let url = try session.offeredURL(now: now) else { return }
            record("ARM id=\(offer.id) card=\(card.id) mode=\(mode.rawValue)")
            if mode == .visible { sheet = .share(url) }
        } catch { errorMessage = "Could not arm the synthetic offer."; record("ARM_FAILED") }
    }

    func disarm(_ reason: String) {
        let id = session.armed?.id
        session.disarm()
        if let id { record("DISARM id=\(id) reason=\(reason)") }
    }

    func expire(id: UUID, now: Date = Date()) {
        let wasArmed = session.armed?.id == id
        session.expireOffer(id: id, now: now)
        if wasArmed && session.armed == nil { record("OFFER_EXPIRED id=\(id)") }
    }

    func receive(_ url: URL, now: Date = Date()) {
        do {
            let envelope = try SyntheticNearbyCodec.decode(url, now: now)
            if sheet != nil && session.pending == nil {
                record("RECEIVER_BUSY id=\(envelope.id) not_saved=true")
                return
            }
            let result = try session.receive(url, now: now)
            if result == .awaitingConsent { errorMessage = nil }
            record("URL_RECEIVED id=\(envelope.id) card=\(envelope.card.id) result=\(result)")
            if result == .awaitingConsent { sheet = .receive(envelope) }
        } catch {
            errorMessage = "This synthetic offer is invalid or expired. Ask the sender to arm a fresh offer."
            record("URL_REJECTED")
        }
    }

    func decide(_ envelope: SyntheticNearbyEnvelope, accept: Bool, now: Date = Date()) {
        guard session.pending?.id == envelope.id else {
            record("STALE_DECISION_IGNORED id=\(envelope.id)")
            return
        }
        errorMessage = nil
        disk.failNextDecision = failNextSave
        failNextSave = false
        do {
            if accept { try session.accept(id: envelope.id, now: now) }
            else { try session.decline(id: envelope.id) }
            sheet = nil
            record("\(accept ? "RECIPIENT_SAVED" : "RECIPIENT_DECLINED") id=\(envelope.id) card=\(envelope.card.id)")
        } catch {
            if session.pending == nil {
                sheet = nil
                errorMessage = "The offer expired. Nothing was saved; ask for a fresh offer."
                record("CONSENT_EXPIRED id=\(envelope.id) not_saved=true")
            } else {
                errorMessage = "The decision could not be saved. Nothing changed. Try Accept or Decline again."
                record("DECISION_WRITE_FAILED id=\(envelope.id) not_saved=true")
            }
        }
    }

    func sheetDismissed() {
        if let id = session.pending?.id {
            do {
                try session.cancelReceipt()
                record("RECIPIENT_CANCELLED id=\(id) not_saved=true")
            } catch {
                // Preserve pending consent when cancellation cannot be persisted.
                errorMessage = "Cancellation could not be saved. Retry Decline."
                if let pending = session.pending { sheet = .receive(pending) }
                record("CANCEL_WRITE_FAILED id=\(id) not_saved=true")
            }
        }
        disarm("sheet_dismissed")
    }

    var exportLog: String {
        let formatter = ISO8601DateFormatter()
        return "Probe 0.3 / PortofolioNearby. Synthetic fixtures only.\nSender completion is NOT recipient receipt.\n" + events.map {
            formatter.string(from: $0.time) + " " + $0.message
        }.joined(separator: "\n")
    }
}
