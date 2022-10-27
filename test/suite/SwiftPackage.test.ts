//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import { testAssetUri } from "../fixtures";
import { SwiftPackage } from "../../src/SwiftPackage";
import { SwiftToolchain } from "../../src/toolchain/toolchain";
import { Version } from "../../src/utilities/version";

let toolchain: SwiftToolchain | undefined;

suite("SwiftPackage Test Suite", () => {
    setup(async () => {
        toolchain = await SwiftToolchain.create();
    });

    test("No package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("empty-folder"));
        assert.strictEqual(spmPackage.foundPackage, false);
    }).timeout(10000);

    test("Invalid package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("invalid-package"));
        assert.strictEqual(spmPackage.foundPackage, true);
        assert.strictEqual(spmPackage.isValid, false);
    }).timeout(10000);

    test("Executable package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package1"));
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.executableProducts.length, 1);
        assert.strictEqual(spmPackage.executableProducts[0].name, "package1");
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert.strictEqual(spmPackage.targets.length, 2);
        assert(spmPackage.resolved !== undefined);
    }).timeout(10000);

    test("Library package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package2"));
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.libraryProducts.length, 1);
        assert.strictEqual(spmPackage.libraryProducts[0].name, "package2");
        assert.strictEqual(spmPackage.dependencies.length, 0);
        assert.strictEqual(spmPackage.targets.length, 2);
    }).timeout(10000);

    test("Package resolve v2", async () => {
        if (toolchain && toolchain.swiftVersion < new Version(5, 6, 0)) {
            return;
        }
        const spmPackage = await SwiftPackage.create(testAssetUri("package5.6"));
        assert.strictEqual(spmPackage.isValid, true);
        assert(spmPackage.resolved !== undefined);
    }).timeout(15000);

    test("Identity case-insensitivity", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("identity-case"));
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert(spmPackage.resolved !== undefined);
        assert.strictEqual(spmPackage.resolved.pins.length, 1);
        assert.strictEqual(spmPackage.resolved.pins[0].identity, "yams");
    }).timeout(10000);

    test("Identity different from name", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("identity-different"));
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert(spmPackage.resolved !== undefined);
        assert.strictEqual(spmPackage.resolved.pins.length, 1);
        assert.strictEqual(spmPackage.resolved.pins[0].identity, "swift-cmark");
    }).timeout(10000);
});
