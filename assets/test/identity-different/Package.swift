// swift-tools-version:5.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "identity-different",
    products: [
        // Products define the executables and libraries a package produces, and make them visible to other packages.
        .library(
            name: "identity-different",
            targets: ["identity-different"]),
    ],
    dependencies: [
        // Dependencies declare other packages that this package depends on.
        .package(url: "https://github.com/apple/swift-log.git", from: "1.5.2"),
    ],
    targets: [
        // Targets are the basic building blocks of a package. A target can define a module or a test suite.
        // Targets can depend on other targets in this package, and on products in packages this package depends on.
        .target(
            name: "identity-different",
            dependencies: [.product(name: "Logging", package: "swift-log")]),
    ]
)
