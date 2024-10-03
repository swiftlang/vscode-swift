// swift-tools-version:5.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "defaultPackage",
    products: [
        .library(
            name: "PackageLib",
            targets: ["PackageLib"]),
    ],
    targets: [
        // Targets are the basic building blocks of a package. A target can define a module or a test suite.
        // Targets can depend on other targets in this package, and on products in packages this package depends on.
        .executableTarget(
            name: "PackageExe",
            dependencies: ["PackageLib"]
        ),
        .target(
            name: "PackageLib",
            dependencies: []
        ),
        .testTarget(
            name: "PackageTests",
            dependencies: ["PackageLib"]),
    ]
)
