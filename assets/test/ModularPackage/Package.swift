// swift-tools-version:6.0

import PackageDescription

internal let package = Package(
    name: "ModularPackage",
    dependencies: [
        .package(path: "Module1"),
        .package(path: "Module2"),
    ]
)
