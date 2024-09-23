// swift-tools-version:5.6
import PackageDescription

let package = Package(
    name: "MyPoint",
    products: [
        .library(name: "MyPoint", targets: ["MyPoint"]),
    ],
    targets: [
        .target(name: "MyPoint"),
    ]
)