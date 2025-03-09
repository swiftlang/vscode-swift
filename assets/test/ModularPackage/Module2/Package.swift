// swift-tools-version:6.0

import PackageDescription

internal let package = Package(
    name: "Module2",
    products: [
        .executable(name: "Module2Demo", targets: ["Module2Demo"]),
    ],
    targets: [
        .testTarget(
            name: "Module2Tests", 
            dependencies: ["Module2"]
        ),
        .executableTarget(
            name: "Module2Demo", 
            dependencies: ["Module2"]
        ),
        .target(
            name: "Module2"
        ),
    ]
)
