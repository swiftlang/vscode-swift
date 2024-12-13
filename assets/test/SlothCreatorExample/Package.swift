// swift-tools-version:5.5
/*
See LICENSE folder for this sample’s licensing information.

Abstract:
Package manifest for SlothCreator.
*/

import PackageDescription

let package = Package(
    name: "SlothCreator",
    platforms: [
        .macOS(.v11),
        .iOS(.v14),
        .watchOS(.v7),
        .tvOS(.v13)
    ],
    products: [
        .library(
            name: "SlothCreator",
            targets: ["SlothCreator"]
        )
    ],
    dependencies: [
        // other dependencies
        .package(url: "https://github.com/swiftlang/swift-docc-plugin", from: "1.4.3"),
    ],
    targets: [
        .target(
            name: "SlothCreator",
            resources: [
                .process("Resources/")
            ]
        )
    ]
)
