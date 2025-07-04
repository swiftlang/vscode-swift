// swift-tools-version: 5.6
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "excluded",
    products: [
        .library(name: "excluded", targets: ["excluded"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "excluded"),
    ]
)
