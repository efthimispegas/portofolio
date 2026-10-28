import Foundation
import Testing
@testable import PortofolioNearby

private let epoch = Date(timeIntervalSince1970: 1_793_000_000)
private func offer(_ card: SyntheticNearbyCard = .electrician) -> SyntheticNearbyEnvelope {
    .init(card: card, now: epoch)
}

@Suite @MainActor
struct SessionTests {
    @Test func receiptRequiresExplicitConsentAndSuccessfulCommit() throws {
        var disk = SyntheticNearbySnapshot()
        let session = try SyntheticNearbySession { disk = $0 }
        let envelope = offer()
        let result = try session.receive(SyntheticNearbyCodec.url(for: envelope), now: epoch)
        #expect(result == .awaitingConsent)
        #expect(session.snapshot.cards.isEmpty && disk.cards.isEmpty)
        try session.accept(id: envelope.id, now: epoch)
        #expect(disk.cards == [.electrician])
        #expect(session.snapshot == disk)
        #expect(session.pending == nil)
    }

    @Test func failedCommitKeepsConsentForRetry() throws {
        enum DiskError: Error { case unavailable }
        var fail = true
        let session = try SyntheticNearbySession { _ in if fail { throw DiskError.unavailable } }
        let envelope = offer()
        _ = try session.receive(SyntheticNearbyCodec.url(for: envelope), now: epoch)
        #expect(throws: DiskError.self) { try session.accept(id: envelope.id, now: epoch) }
        #expect(session.snapshot.cards.isEmpty)
        #expect(session.pending?.id == envelope.id)
        fail = false
        try session.accept(id: envelope.id, now: epoch)
        #expect(session.snapshot.cards == [.electrician])
    }

    @Test func expiryWhilePreviewIsOpenCannotSave() throws {
        var writes = 0
        let session = try SyntheticNearbySession { _ in writes += 1 }
        let envelope = offer()
        _ = try session.receive(SyntheticNearbyCodec.url(for: envelope), now: epoch)
        #expect(throws: SyntheticNearbyError.expired) {
            try session.accept(id: envelope.id, now: epoch.addingTimeInterval(301))
        }
        #expect(writes == 0 && session.snapshot.cards.isEmpty && session.pending == nil)
    }

    @Test func declineBlocksReplayButAllowsFreshRetry() throws {
        let session = try SyntheticNearbySession { _ in }
        let envelope = offer()
        let url = try SyntheticNearbyCodec.url(for: envelope)
        _ = try session.receive(url, now: epoch)
        try session.decline(id: envelope.id)
        #expect(try session.receive(url, now: epoch) == .duplicateTransfer)
        #expect(session.snapshot.cards.isEmpty)
        let retry = offer()
        #expect(try session.receive(SyntheticNearbyCodec.url(for: retry), now: epoch) == .awaitingConsent)
        try session.accept(id: retry.id, now: epoch)
        #expect(session.snapshot.cards == [.electrician])
    }

    @Test func pendingOfferCannotBeReplacedByAnotherDelivery() throws {
        let session = try SyntheticNearbySession { _ in }
        let first = offer(), other = offer(.plumber)
        let firstURL = try SyntheticNearbyCodec.url(for: first)
        _ = try session.receive(firstURL, now: epoch)
        #expect(try session.receive(firstURL, now: epoch) == .duplicateTransfer)
        #expect(try session.receive(SyntheticNearbyCodec.url(for: other), now: epoch) == .busy)
        #expect(session.pending == first)
        #expect(throws: NearbySessionError.noMatchingConsent) { try session.accept(id: other.id, now: epoch) }
        #expect(session.snapshot.cards.isEmpty)
    }

    @Test func duplicateCardWithFreshTransferDoesNotReorderSavedCards() throws {
        let session = try SyntheticNearbySession { _ in }
        for card in SyntheticNearbyCard.fixtures {
            let envelope = offer(card)
            _ = try session.receive(SyntheticNearbyCodec.url(for: envelope), now: epoch)
            try session.accept(id: envelope.id, now: epoch)
        }
        #expect(try session.receive(SyntheticNearbyCodec.url(for: offer()), now: epoch) == .alreadySaved)
        #expect(session.snapshot.cards == [.electrician, .plumber])
    }

    @Test func cancellationAndRestorePreserveDecisionsOnly() throws {
        var disk = SyntheticNearbySnapshot()
        let session = try SyntheticNearbySession { disk = $0 }
        try session.arm(.plumber, now: epoch)
        let envelope = offer(), url = try SyntheticNearbyCodec.url(for: envelope)
        _ = try session.receive(url, now: epoch)
        try session.cancelReceipt()
        let restored = try SyntheticNearbySession(restored: disk) { _ in }
        #expect(restored.armed == nil && restored.pending == nil && restored.snapshot.cards.isEmpty)
        #expect(try restored.receive(url, now: epoch) == .duplicateTransfer)
    }

    @Test func staleTimerCannotDisarmReplacementOffer() throws {
        let session = try SyntheticNearbySession { _ in }
        try session.arm(.electrician, now: epoch)
        let first = try #require(session.armed)
        try session.arm(.plumber, now: epoch.addingTimeInterval(10))
        session.expireOffer(id: first.id, now: epoch.addingTimeInterval(301))
        #expect(session.armed?.card == .plumber)
        #expect(try session.offeredURL(now: epoch.addingTimeInterval(309)) != nil)
        #expect(try session.offeredURL(now: epoch.addingTimeInterval(310)) == nil)
        #expect(session.snapshot.cards.isEmpty)
    }

    @Test func disarmDoesNotModifyReceivedCardsOrClaimRemoteSave() throws {
        let session = try SyntheticNearbySession(restored: .init(cards: [.electrician])) { _ in
            Issue.record("Sender actions must not commit receiver storage")
        }
        try session.arm(.plumber, now: epoch)
        #expect(try session.offeredURL(now: epoch) != nil)
        session.disarm()
        #expect(try session.offeredURL(now: epoch) == nil)
        #expect(session.snapshot.cards == [.electrician])
    }

    @Test func invalidRestoredSnapshotIsRejected() {
        #expect(throws: NearbySessionError.invalidSnapshot) {
            _ = try SyntheticNearbySession(restored: .init(cards: [.electrician, .electrician])) { _ in }
        }
    }

    @Test func persistenceRoundTripRetainsAcceptedCardAndReplayProtection() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("synthetic-snapshot.json")
        let session = try SyntheticNearbySession { snapshot in
            try JSONEncoder().encode(snapshot).write(to: file, options: .atomic)
        }
        let envelope = offer(), url = try SyntheticNearbyCodec.url(for: envelope)
        _ = try session.receive(url, now: epoch)
        try session.accept(id: envelope.id, now: epoch)
        let restored = try JSONDecoder().decode(SyntheticNearbySnapshot.self, from: Data(contentsOf: file))
        let reopened = try SyntheticNearbySession(restored: restored) { _ in }
        #expect(reopened.snapshot.cards == [.electrician])
        #expect(try reopened.receive(url, now: epoch) == .duplicateTransfer)
    }
}

@Suite struct CodecTests {
    @Test func acceptsURLGeneratedByUnchangedProbe02() throws {
        let file = try #require(Bundle.module.url(forResource: "probe-0.2-url", withExtension: "txt", subdirectory: "Fixtures"))
        let raw = try String(contentsOf: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let envelope = try SyntheticNearbyCodec.decode(#require(URL(string: raw)), now: epoch)
        #expect(envelope.card == .electrician)
        #expect(envelope.id == UUID(uuidString: "00000000-0000-4000-8000-000000000001"))
        #expect(envelope.issuedAt == epoch)
    }

    @Test func roundTrip() throws {
        for card in SyntheticNearbyCard.fixtures {
            let envelope = offer(card)
            #expect(try SyntheticNearbyCodec.decode(SyntheticNearbyCodec.url(for: envelope), now: epoch) == envelope)
        }
    }

    @Test func rejectsUnsafeRoutesAndEncoding() throws {
        let valid = try SyntheticNearbyCodec.url(for: offer()).absoluteString
        let invalid = [
            "https://example.invalid/card?payload=x", valid + "&payload=x", valid + "#fragment",
            "portofolio-probe://card?payload=%21", "portofolio-probe://card/path?payload=x",
            "portofolio-probe://user@card?payload=x", "portofolio-probe://card:80?payload=x",
            "portofolio-probe://card?payload=" + String(repeating: "A", count: 9000)
        ]
        for value in invalid {
            #expect(throws: (any Error).self) { _ = try SyntheticNearbyCodec.decode(URL(string: value)!, now: epoch) }
        }
    }

    @Test func rejectsChangedFixtureAndSchema() throws {
        let data = try JSONEncoder().encode(offer())
        let raw = try #require(String(data: data, encoding: .utf8))
        for value in [raw.replacingOccurrences(of: "Portofolio Demo A", with: "Real business"),
                      raw.replacingOccurrences(of: "\"version\":1", with: "\"version\":2")] {
            let encoded = Data(value.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            #expect(throws: SyntheticNearbyError.invalidPayload) {
                _ = try SyntheticNearbyCodec.decode(URL(string: "portofolio-probe://card?payload=" + encoded)!, now: epoch)
            }
        }
    }

    @Test func timestampBounds() throws {
        let url = try SyntheticNearbyCodec.url(for: offer())
        #expect(throws: SyntheticNearbyError.expired) { _ = try SyntheticNearbyCodec.decode(url, now: epoch.addingTimeInterval(301)) }
        #expect(throws: SyntheticNearbyError.expired) { _ = try SyntheticNearbyCodec.decode(url, now: epoch.addingTimeInterval(-61)) }
        #expect(try SyntheticNearbyCodec.decode(url, now: epoch.addingTimeInterval(-60)).card == .electrician)
    }
}
