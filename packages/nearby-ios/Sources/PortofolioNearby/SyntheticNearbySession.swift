import Foundation
import Combine

/// Local synthetic evidence only. Never restore pending consent or an armed provider.
public struct SyntheticNearbySnapshot: Codable, Equatable, Sendable {
    public var cards: [SyntheticNearbyCard]
    public var decidedTransfers: Set<UUID>

    public init(cards: [SyntheticNearbyCard] = [], decidedTransfers: Set<UUID> = []) {
        self.cards = cards
        self.decidedTransfers = decidedTransfers
    }
}

public enum NearbyReceipt: Equatable {
    case awaitingConsent, duplicateTransfer, alreadySaved, busy
}

public enum NearbySessionError: Error, Equatable {
    case invalidSnapshot, noMatchingConsent
}

/// Single-owner session for the approved local experiment, not a production identity boundary.
/// The commit closure must persist the entire snapshot atomically, or throw without committing it.
@MainActor
public final class SyntheticNearbySession: ObservableObject {
    @Published public private(set) var armed: SyntheticNearbyEnvelope?
    @Published public private(set) var pending: SyntheticNearbyEnvelope?
    @Published public private(set) var snapshot: SyntheticNearbySnapshot
    private let commit: (SyntheticNearbySnapshot) throws -> Void

    public init(
        restored: SyntheticNearbySnapshot = .init(),
        commit: @escaping (SyntheticNearbySnapshot) throws -> Void
    ) throws {
        guard restored.cards.allSatisfy(SyntheticNearbyCard.fixtures.contains),
              Set(restored.cards.map(\.id)).count == restored.cards.count else {
            throw NearbySessionError.invalidSnapshot
        }
        snapshot = restored
        self.commit = commit
    }

    /// Explicit arming replaces the old offer; it never changes the recipient's saved state.
    public func arm(_ card: SyntheticNearbyCard, now: Date = Date()) throws {
        let envelope = SyntheticNearbyEnvelope(card: card, now: now)
        _ = try SyntheticNearbyCodec.decode(SyntheticNearbyCodec.url(for: envelope), now: now)
        armed = envelope
    }

    public func disarm() { armed = nil }

    /// A late timeout from a previous offer must not disarm a newly selected card.
    public func expireOffer(id: UUID, now: Date = Date()) {
        guard let offer = armed, offer.id == id,
              now.timeIntervalSince(offer.issuedAt) >= 300 else { return }
        disarm()
    }

    public func offeredURL(now: Date = Date()) throws -> URL? {
        guard let offer = armed else { return nil }
        expireOffer(id: offer.id, now: now)
        guard armed != nil else { return nil }
        let url = try SyntheticNearbyCodec.url(for: offer)
        _ = try SyntheticNearbyCodec.decode(url, now: now)
        return url
    }

    public func receive(_ url: URL, now: Date = Date()) throws -> NearbyReceipt {
        let envelope = try SyntheticNearbyCodec.decode(url, now: now)
        if snapshot.decidedTransfers.contains(envelope.id) || pending?.id == envelope.id {
            return .duplicateTransfer
        }
        if snapshot.cards.contains(where: { $0.id == envelope.card.id }) { return .alreadySaved }
        guard pending == nil else { return .busy }
        pending = envelope
        return .awaitingConsent
    }

    /// Revalidate at the time of consent. A valid preview can expire while it is open.
    /// A failed disk write leaves consent pending and never reports a saved card.
    public func accept(id: UUID, now: Date = Date()) throws {
        guard let envelope = pending, envelope.id == id else { throw NearbySessionError.noMatchingConsent }
        do {
            _ = try SyntheticNearbyCodec.decode(SyntheticNearbyCodec.url(for: envelope), now: now)
        } catch {
            pending = nil
            throw error
        }
        var next = snapshot
        next.decidedTransfers.insert(id)
        if !next.cards.contains(where: { $0.id == envelope.card.id }) { next.cards.append(envelope.card) }
        try commit(next)
        snapshot = next
        pending = nil
    }

    public func decline(id: UUID) throws {
        guard pending?.id == id else { throw NearbySessionError.noMatchingConsent }
        var next = snapshot
        next.decidedTransfers.insert(id)
        try commit(next)
        snapshot = next
        pending = nil
    }

    /// Call for explicit dismissal/leaving the receiving flow; never an implicit acceptance.
    public func cancelReceipt() throws {
        if let id = pending?.id { try decline(id: id) }
    }
}
