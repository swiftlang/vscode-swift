// swift-tools-version:5.6
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "dependencies",
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-markdown.git", branch: "main"),
        .package(path: "../defaultPackage"),
    ],
    targets: [
        .executableTarget(
            name: "dependencies",
            dependencies: [.product(name: "Markdown", package: "swift-markdown")],
            path: "Sources"),
    ]
)
