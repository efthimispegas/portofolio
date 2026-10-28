// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProbeHarness",
    platforms: [.macOS("14.0"), .iOS("26.0")],
    dependencies: [.package(path: "../../packages/nearby-ios")],
    targets: [
        .target(name: "ProbeHarness", dependencies: [.product(name: "PortofolioNearby", package: "nearby-ios")],
                path: "Sources", exclude: ["ProbeApp.swift", "ProbeProtocol.swift"], sources: ["ProbeStore.swift"]),
        .testTarget(name: "ProbeHarnessTests", dependencies: ["ProbeHarness"], path: "HarnessTests")
    ]
)
