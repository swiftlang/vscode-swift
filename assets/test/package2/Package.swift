// swift-tools-version:5.5
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "package2",
    products: [
        .library(name: "package2", targets: ["package2"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "package2", dependencies: []),
        .testTarget(name: "package2Tests", dependencies: ["package2"]),
    ]
)
