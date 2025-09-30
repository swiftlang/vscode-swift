// swift-tools-version: 5.9
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
        .package(url: "https://github.com/swiftlang/swift-markdown.git", exact: "0.6.0"),
        .package(path: "../defaultPackage"),
    ],
    targets: [
        .target(
            name: "LibraryTarget",
            plugins: [
                .plugin(name: "BuildToolPlugin")
            ]
        ),
        .executableTarget(
            name: "ExecutableTarget"
        ),
        .executableTarget(
            name: "BuildToolExecutableTarget"
        ),
        .plugin(
            name: "PluginTarget",
            capability: .command(
                intent: .custom(verb: "testing", description: "A plugin for testing plugins")
            )
        ),
        .plugin(
            name: "BuildToolPlugin",
            capability: .buildTool(),
            dependencies: ["BuildToolExecutableTarget"]
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
