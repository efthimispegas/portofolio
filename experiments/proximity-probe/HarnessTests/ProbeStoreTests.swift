import Foundation
import Testing
import PortofolioNearby
@testable import ProbeHarness

private let epoch = Date(timeIntervalSince1970: 1_793_000_000)

@Suite @MainActor
struct ProbeStoreTests {
    func withStore(_ action: (ProbeStore, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try action(ProbeStore(directory: directory), directory)
    }

    func deliver(_ store: ProbeStore, card: SyntheticNearbyCard = .electrician) throws -> SyntheticNearbyEnvelope {
        let envelope = SyntheticNearbyEnvelope(card: card, now: epoch)
        store.receive(try SyntheticNearbyCodec.url(for: envelope), now: epoch)
        return envelope
    }

    @Test func consentCommitsToDiskAndSurvivesRelaunch() throws {
        try withStore { store, directory in
            let envelope = try deliver(store)
            #expect(store.accepted.isEmpty)
            #expect(store.sheet?.id == "receive-" + envelope.id.uuidString)
            store.decide(envelope, accept: true, now: epoch)
            #expect(store.accepted == [.electrician])
            let reopened = try ProbeStore(directory: directory)
            #expect(reopened.accepted == [.electrician])
            #expect(reopened.session.armed == nil && reopened.session.pending == nil)
            #expect(reopened.events.contains { $0.message.contains("RECIPIENT_SAVED id=\(envelope.id)") })
        }
    }

    @Test func simulatedSaveFailureDoesNotClaimSaveAndRetryCommitsOnce() throws {
        try withStore { store, directory in
            let envelope = try deliver(store)
            store.failNextSave = true
            store.decide(envelope, accept: true, now: epoch)
            #expect(store.accepted.isEmpty && store.session.pending?.id == envelope.id)
            #expect(store.errorMessage != nil && store.sheet != nil)
            #expect(try ProbeStore(directory: directory).accepted.isEmpty)
            #expect(!store.events.contains { $0.message.contains("RECIPIENT_SAVED") })
            store.decide(envelope, accept: true, now: epoch)
            #expect(store.accepted == [.electrician] && store.sheet == nil)
            #expect(try ProbeStore(directory: directory).accepted == [.electrician])
        }
    }

    @Test func dismissalDeclinesAndFreshOfferCanRetry() throws {
        try withStore { store, _ in
            let first = try deliver(store)
            store.sheet = nil
            store.sheetDismissed()
            #expect(store.session.pending == nil && store.accepted.isEmpty)
            store.receive(try SyntheticNearbyCodec.url(for: first), now: epoch)
            #expect(store.sheet == nil)
            let retry = try deliver(store)
            store.decide(retry, accept: true, now: epoch)
            #expect(store.accepted == [.electrician])
        }
    }

    @Test func expiredConsentClosesWithoutSaving() throws {
        try withStore { store, _ in
            let envelope = try deliver(store)
            store.decide(envelope, accept: true, now: epoch.addingTimeInterval(301))
            #expect(store.accepted.isEmpty && store.sheet == nil)
            #expect(store.errorMessage?.contains("expired") == true)
        }
    }

    @Test func busySheetDoesNotCreateUnseenPendingConsent() throws {
        try withStore { store, _ in
            store.sheet = .evidence
            _ = try deliver(store)
            #expect(store.session.pending == nil && store.accepted.isEmpty)
            #expect(store.sheet?.id == "evidence")
        }
    }

    @Test func replacementDeliveryCannotReplaceConsentSheet() throws {
        try withStore { store, _ in
            let first = try deliver(store)
            _ = try deliver(store, card: .plumber)
            #expect(store.session.pending?.id == first.id)
            #expect(store.sheet?.id == "receive-" + first.id.uuidString)
        }
    }

    @Test func acceptedCardDoesNotShowConsentAgain() throws {
        try withStore { store, _ in
            let first = try deliver(store)
            store.decide(first, accept: true, now: epoch)
            _ = try deliver(store)
            #expect(store.sheet == nil && store.accepted == [.electrician])
            #expect(store.events.last?.message.contains("alreadySaved") == true)
        }
    }

    @Test func backgroundDisarmRequiresExplicitRearm() throws {
        try withStore { store, _ in
            store.mode = .shareLink
            store.arm(now: epoch)
            let firstID = try #require(store.session.armed?.id)
            store.disarm("background")
            #expect(store.armedURL == nil)
            store.arm(now: epoch.addingTimeInterval(1))
            #expect(store.session.armed?.id != firstID)
        }
    }

    @Test func preservesLegacyEvidenceAndFailsClosedOnCorruption() throws {
        try withStore { _, directory in
            let legacy = directory.appendingPathComponent("probe-evidence.json")
            let bytes = Data("legacy evidence remains untouched".utf8)
            try bytes.write(to: legacy)
            _ = try ProbeStore(directory: directory)
            #expect(try Data(contentsOf: legacy) == bytes)
            let current = directory.appendingPathComponent("probe-v03-evidence.json")
            let corrupt = Data("malformed evidence".utf8)
            try corrupt.write(to: current)
            #expect(throws: (any Error).self) { _ = try ProbeStore(directory: directory) }
            #expect(try Data(contentsOf: current) == corrupt)
        }
    }

    @Test func realCancellationWriteFailurePreservesConsentUntilStorageReturns() throws {
        try withStore { store, directory in
            let envelope = try deliver(store)
            let displaced = directory.appendingPathExtension("temporarily-unavailable")
            try FileManager.default.moveItem(at: directory, to: displaced)
            defer {
                if FileManager.default.fileExists(atPath: displaced.path) {
                    try? FileManager.default.moveItem(at: displaced, to: directory)
                }
            }
            store.sheet = nil
            store.sheetDismissed()
            #expect(store.session.pending?.id == envelope.id)
            #expect(store.sheet?.id == "receive-" + envelope.id.uuidString)
            #expect(store.accepted.isEmpty && store.errorMessage != nil)
            let onDisk = try JSONDecoder().decode(HarnessSnapshot.self, from: Data(contentsOf: displaced.appendingPathComponent("probe-v03-evidence.json")))
            #expect(onDisk.state.cards.isEmpty && !onDisk.state.decidedTransfers.contains(envelope.id))
            try FileManager.default.moveItem(at: displaced, to: directory)
            store.decide(envelope, accept: false, now: epoch)
            #expect(store.session.pending == nil && store.sheet == nil)
            let reopened = try ProbeStore(directory: directory)
            reopened.receive(try SyntheticNearbyCodec.url(for: envelope), now: epoch)
            #expect(reopened.sheet == nil && reopened.accepted.isEmpty)
        }
    }

    @Test func lateExpiryDoesNotDisarmReplacementOrWriteFalseExpiryEvidence() throws {
        try withStore { store, _ in
            store.mode = .shareLink
            store.arm(now: epoch)
            let first = try #require(store.session.armed?.id)
            store.arm(now: epoch.addingTimeInterval(10))
            let replacement = try #require(store.session.armed?.id)
            store.expire(id: first, now: epoch.addingTimeInterval(301))
            #expect(store.session.armed?.id == replacement)
            #expect(!store.events.contains { $0.message.contains("OFFER_EXPIRED") })
            store.expire(id: replacement, now: epoch.addingTimeInterval(310))
            store.expire(id: replacement, now: epoch.addingTimeInterval(311))
            #expect(store.armedURL == nil)
            #expect(store.events.filter { $0.message.contains("OFFER_EXPIRED") }.count == 1)
        }
    }

    @Test func restartDropsUnfinishedConsentWithoutSavingOrRestoringExposure() throws {
        try withStore { store, directory in
            store.mode = .shareLink
            store.arm(now: epoch)
            let envelope = try deliver(store)
            let reopened = try ProbeStore(directory: directory)
            #expect(reopened.session.pending == nil && reopened.armedURL == nil && reopened.accepted.isEmpty)
            reopened.receive(try SyntheticNearbyCodec.url(for: envelope), now: epoch)
            #expect(reopened.session.pending?.id == envelope.id && reopened.accepted.isEmpty)
        }
    }

    @Test func freshOfferClearsPreviousExpiryStatus() throws {
        try withStore { store, _ in
            let expired = try deliver(store)
            store.decide(expired, accept: true, now: epoch.addingTimeInterval(301))
            #expect(store.errorMessage != nil)
            let fresh = SyntheticNearbyEnvelope(card: .plumber, now: epoch.addingTimeInterval(302))
            store.receive(try SyntheticNearbyCodec.url(for: fresh), now: epoch.addingTimeInterval(302))
            #expect(store.errorMessage == nil && store.session.pending?.id == fresh.id)
        }
    }

    @Test func staleAcceptCallbackCannotReportFailureAfterSuccessfulSave() throws {
        try withStore { store, _ in
            let envelope = try deliver(store)
            store.decide(envelope, accept: true, now: epoch)
            store.decide(envelope, accept: true, now: epoch)
            #expect(store.accepted == [.electrician] && store.errorMessage == nil)
            #expect(store.events.filter { $0.message.contains("RECIPIENT_SAVED") }.count == 1)
            #expect(!store.events.contains { $0.message.contains("CONSENT_EXPIRED") })
        }
    }
}
