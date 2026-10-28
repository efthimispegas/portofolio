import Foundation

struct SyntheticCard: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let category: String
    let area: String

    static let electrician = SyntheticCard(id: "demo-electrician", name: "Portofolio Demo A", category: "Ηλεκτρολόγος", area: "Συνθετικά στοιχεία")
    static let plumber = SyntheticCard(id: "demo-plumber", name: "Portofolio Demo B", category: "Υδραυλικός", area: "Συνθετικά στοιχεία")
    static let fixtures = [electrician, plumber]
}

struct ProbeEnvelope: Codable, Equatable, Identifiable {
    let version: Int
    let id: UUID
    let issuedAt: Date
    let card: SyntheticCard

    init(card: SyntheticCard, now: Date = Date(), id: UUID = UUID()) {
        self.version = 1
        self.id = id
        self.issuedAt = now
        self.card = card
    }
}

enum ProbeProtocolError: String, Error {
    case invalidRoute, invalidEncoding, invalidPayload, expired
}

enum ProbeProtocol {
    static func url(for envelope: ProbeEnvelope) throws -> URL {
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
        guard let result = parts.url else { throw ProbeProtocolError.invalidEncoding }
        return result
    }

    static func decode(_ url: URL, now: Date = Date()) throws -> ProbeEnvelope {
        guard url.absoluteString.utf8.count <= 8192,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "portofolio-probe", parts.host == "card",
              parts.path.isEmpty, parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil,
              let items = parts.queryItems, items.count == 1,
              items[0].name == "payload", let value = items[0].value,
              !value.isEmpty else { throw ProbeProtocolError.invalidRoute }
        let alphabet = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        guard value.unicodeScalars.allSatisfy(alphabet.contains) else { throw ProbeProtocolError.invalidEncoding }
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let bytes = Data(base64Encoded: base64), bytes.count <= 4096 else { throw ProbeProtocolError.invalidEncoding }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        guard let envelope = try? decoder.decode(ProbeEnvelope.self, from: bytes),
              envelope.version == 1,
              SyntheticCard.fixtures.contains(envelope.card) else { throw ProbeProtocolError.invalidPayload }
        let age = now.timeIntervalSince(envelope.issuedAt)
        guard age >= -60, age <= 300 else { throw ProbeProtocolError.expired }
        return envelope
    }
}
