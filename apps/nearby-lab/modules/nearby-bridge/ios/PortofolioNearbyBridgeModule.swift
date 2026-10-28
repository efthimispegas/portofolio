import ExpoModulesCore
import SwiftUI
import UIKit
import Combine
import Security

public final class PortofolioNearbyBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PortofolioNearbyBridge")
    Function("buildProfile") { () -> String in
      Bundle.main.object(forInfoDictionaryKey: "PortofolioLabProfile") as? String ?? "unknown"
    }
    Function("randomToken") { () throws -> String in
      var bytes = [UInt8](repeating: 0, count: 32)
      guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        throw NSError(domain: "NearbyLab", code: 1)
      }
      return bytes.map { String(format: "%02x", $0) }.joined()
    }
    Function("writeEvidence") { (json: String) throws in
      guard let data = json.data(using: .utf8), data.count <= 1_048_576 else {
        throw NSError(domain: "NearbyLab", code: 2)
      }
      try data.write(to: URL.documentsDirectory.appendingPathComponent("nearby-lab-evidence.json"),
                     options: [.atomic, .completeFileProtection])
    }
    View(NearbyExposureView.self) {
      Events("onState")
      Prop("offer") { (view, offer: [String: Any]?) in view.setOffer(offer) }
    }
  }
}

private struct Exposure: Equatable {
  let id: String
  let url: URL
  let expiresAt: Date
}
private final class ExposureModel: ObservableObject {
  @Published var offer: Exposure?
}
private struct ExposureRoot: View {
  @ObservedObject var model: ExposureModel
  var body: some View {
    Group {
      if let offer = model.offer {
        ShareLink(item: offer.url, preview: SharePreview("Portofolio synthetic card")) {
          Text("Experimental provider")
        }.id(offer.id).hidden().accessibilityHidden(true).allowsHitTesting(false)
      }
    }.frame(width: 1, height: 1)
  }
}

/// The hosted composition requires new device acceptance; standalone probe success is not parity proof.
final class NearbyExposureView: ExpoView {
  let onState = EventDispatcher()
  private let model = ExposureModel()
  private var controller: UIHostingController<ExposureRoot>!
  private var expiryTimer: Timer?
  private var backgroundObserver: NSObjectProtocol?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    controller = UIHostingController(rootView: ExposureRoot(model: model))
    controller.view.backgroundColor = .clear
    controller.view.isUserInteractionEnabled = false
    addSubview(controller.view)
    backgroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.disarm("background") }
  }
  deinit {
    expiryTimer?.invalidate()
    if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    controller.view.frame = bounds
    attachController()
  }
  private func attachController() {
    guard window != nil, controller.parent == nil else { return }
    var responder: UIResponder? = self
    while let current = responder {
      if let parent = current as? UIViewController {
        parent.addChild(controller)
        controller.didMove(toParent: parent)
        return
      }
      responder = current.next
    }
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      disarm("unmounted")
      controller.willMove(toParent: nil)
      controller.removeFromParent()
    } else { attachController() }
  }
  func setOffer(_ raw: [String: Any]?) {
    guard let raw else { disarm("stopped"); return }
    guard let id = raw["id"] as? String, !id.isEmpty, id.count <= 80,
      let text = raw["url"] as? String,
      let parts = URLComponents(string: text), parts.scheme == "https",
      parts.host == "portofolio.pegasoft.ai", parts.user == nil, parts.password == nil,
      parts.port == nil, parts.query == nil, parts.fragment == nil,
      parts.path.range(of: "^/nearby/[0-9a-f]{64}$", options: .regularExpression) != nil,
      let url = parts.url, url.absoluteString == text,
      let milliseconds = raw["expiresAt"] as? Double, milliseconds.isFinite else {
      disarm("invalid"); onState(["state": "invalid", "id": raw["id"] as? String ?? "", "reason": "invalid_offer"]); return
    }
    let expiry = Date(timeIntervalSince1970: milliseconds / 1000)
    let remaining = expiry.timeIntervalSinceNow
    guard remaining > 0, remaining <= 300 else {
      disarm("invalid"); onState(["state": "invalid", "id": id, "reason": "invalid_expiry"]); return
    }
    let offer = Exposure(id: id, url: url, expiresAt: expiry)
    if model.offer == offer { return }
    disarm("replaced")
    model.offer = offer
    attachController()
    expiryTimer = Timer.scheduledTimer(withTimeInterval: remaining, repeats: false) { [weak self] _ in
      guard self?.model.offer?.id == id else { return }
      self?.disarm("expired")
    }
    onState(["state": "armed", "id": id])
  }
  private func disarm(_ reason: String) {
    expiryTimer?.invalidate(); expiryTimer = nil
    guard let current = model.offer else { return }
    model.offer = nil
    onState(["state": "disarmed", "reason": reason, "id": current.id])
  }
}
