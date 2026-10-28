// Wire-compatible with the isolated Probe 0.2. Synthetic fixtures only.
import Foundation

public struct SyntheticNearbyCard: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let category: String
    public let area: String

    public static let electrician = SyntheticNearbyCard(id: "demo-electrician", name: "Portofolio Demo A", category: "Ηλεκτρολόγος", area: "Συνθετικά στοιχεία")
    public static let plumber = SyntheticNearbyCard(id: "demo-plumber", name: "Portofolio Demo B", category: "Υδραυλικός", area: "Συνθετικά στοιχεία")
    public static let fixtures = [electrician, plumber]
}

public struct SyntheticNearbyEnvelope: Codable, Equatable, Identifiable, Sendable {
    public let version: Int
    public let id: UUID
    public let issuedAt: Date
    public let card: SyntheticNearbyCard

    public init(card: SyntheticNearbyCard, now: Date = Date(), id: UUID = UUID()) {
        self.version = 1
        self.id = id
        self.issuedAt = now
        self.card = card
    }
}

public enum SyntheticNearbyError: String, Error {
    case invalidRoute, invalidEncoding, invalidPayload, expired
}

public enum SyntheticNearbyCodec {
    public static func url(for envelope: SyntheticNearbyEnvelope) throws -> URL {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        let data = try encoder.encode(envelope)
        let payload = data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        var parts = URLComponents()
        parts.scheme = "portofolio-probe"
        parts.host = "card"
        parts.queryItems = [URLQueryItem(name: "payload", value: payload)]
        guard let result = parts.url else { throw SyntheticNearbyError.invalidEncoding }
        return result
    }

    public static func decode(_ url: URL, now: Date = Date()) throws -> SyntheticNearbyEnvelope {
        guard url.absoluteString.utf8.count <= 8192,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "portofolio-probe", parts.host == "card",
              parts.path.isEmpty, parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil,
              let items = parts.queryItems, items.count == 1,
              items[0].name == "payload", let value = items[0].value,
              !value.isEmpty else { throw SyntheticNearbyError.invalidRoute }
        let alphabet = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        guard value.unicodeScalars.allSatisfy(alphabet.contains) else { throw SyntheticNearbyError.invalidEncoding }
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let bytes = Data(base64Encoded: base64), bytes.count <= 4096 else { throw SyntheticNearbyError.invalidEncoding }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        guard let envelope = try? decoder.decode(SyntheticNearbyEnvelope.self, from: bytes),
              envelope.version == 1,
              SyntheticNearbyCard.fixtures.contains(envelope.card) else { throw SyntheticNearbyError.invalidPayload }
        let age = now.timeIntervalSince(envelope.issuedAt)
        guard age >= -60, age <= 300 else { throw SyntheticNearbyError.expired }
        return envelope
    }
}
