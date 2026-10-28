import Foundation

let now = Date(timeIntervalSince1970: 1_793_000_000)
let original = ProbeEnvelope(card: .electrician, now: now)
let url = try ProbeProtocol.url(for: original)
let decoded = try ProbeProtocol.decode(url, now: now)
precondition(decoded == original, "The actual transmitted payload must round-trip.")

func rejects(_ label: String, url: URL, at time: Date = now) {
    do {
        _ = try ProbeProtocol.decode(url, now: time)
        fatalError("Should reject: \(label)")
    } catch { print("PASS \(label)") }
}

rejects("expired", url: url, at: now.addingTimeInterval(301))
rejects("future clock", url: url, at: now.addingTimeInterval(-61))
rejects("wrong route", url: URL(string: "https://example.invalid/card?payload=x")!)
rejects("duplicate payload", url: URL(string: url.absoluteString + "&payload=x")!)
rejects("unexpected fragment", url: URL(string: url.absoluteString + "#x")!)
rejects("bad encoding", url: URL(string: "portofolio-probe://card?payload=%21")!)
let fake = SyntheticCard(id: "real", name: "Not a fixture", category: "Unknown", area: "Elsewhere")
rejects("non-synthetic fixture", url: try ProbeProtocol.url(for: ProbeEnvelope(card: fake, now: now)))
let tooLarge = URL(string: "portofolio-probe://card?payload=" + String(repeating: "A", count: 9000))!
rejects("oversized input", url: tooLarge)
print("PASS payload round-trip; 8 rejection cases")
