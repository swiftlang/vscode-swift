// swift-tools-version:6.0

import PackageDescription

internal let package = Package(
    name: "Module1",
    products: [
        .executable(name: "Module1Demo", targets: ["Module1Demo"]),
    ],
    targets: [
        .testTarget(
            name: "Module1Tests", 
            dependencies: ["Module1"]
        ),
        .executableTarget(
            name: "Module1Demo", 
            dependencies: ["Module1"]
        ),
        .target(
            name: "Module1"
        ),
    ]
)
