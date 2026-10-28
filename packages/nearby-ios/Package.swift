// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PortofolioNearby",
    platforms: [.iOS("26.0"), .macOS("14.0")],
    products: [.library(name: "PortofolioNearby", targets: ["PortofolioNearby"])],
    targets: [
        .target(name: "PortofolioNearby"),
        .testTarget(name: "PortofolioNearbyTests", dependencies: ["PortofolioNearby"], resources: [.copy("Fixtures")])
    ]
)
