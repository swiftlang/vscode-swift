// swift-tools-version: 5.6
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "package5.6",
    products: [
        .library(name: "package5.6", targets: ["package5.6"]),
    ],
    dependencies: [
        // Dependencies declare other packages that this package depends on.
        .package(url: "https://github.com/apple/swift-nio-ssl.git", from: "2.0.0"),
    ],
    targets: [
        .target(name: "package5.6", dependencies: [
            .product(name: "NIOSSL", package: "swift-nio-ssl")
        ]),
    ]
)
