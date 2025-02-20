// swift-tools-version: 5.6
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "targets",
    products: [
        .library(
            name: "LibraryTarget",
            targets: ["LibraryTarget"]
        ),
        .executable(
            name: "ExecutableTarget",
            targets: ["ExecutableTarget"]
        ),
        .plugin(
            name: "PluginTarget",
            targets: ["PluginTarget"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-markdown.git", branch: "main"),
        .package(path: "../defaultPackage"),
    ],
    targets: [
        .target(
            name: "LibraryTarget"
        ),
        .executableTarget(
            name: "ExecutableTarget"
        ),
        .plugin(
            name: "PluginTarget",
            capability: .command(
                intent: .custom(verb: "testing", description: "A plugin for testing plugins")
            )
        ),
        .testTarget(
            name: "TargetsTests",
            dependencies: ["LibraryTarget"]
        ),
        .testTarget(
            name: "AnotherTests",
            dependencies: ["LibraryTarget"]
        ),
    ]
)
