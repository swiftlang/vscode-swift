// swift-tools-version:6.0
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    // FIXME: Can be changed back to Swift-Markdown when
    // https://github.com/swiftlang/swift-package-manager/issues/7931
    // is released in the toolchain
    // NB: The name here needs to match the name of the dependencies under assets/test/dependencies/Package.swift
    name: "swift-markdown",
    products: [
        // Products define the executables and libraries a package produces, making them visible to other packages.
        .library(
            name: "PackageLib",
            targets: ["PackageLib"]),
    ],
    targets: [
        .target(
            name: "PackageLib",
            dependencies: []
        ),
    ]
)
