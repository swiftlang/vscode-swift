//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import { testAssetUri } from "../fixtures";
import { SwiftPackage } from "../../src/SwiftPackage";
import { SwiftToolchain } from "../../src/toolchain/toolchain";
import { Version } from "../../src/utilities/version";

suite("SwiftPackage Test Suite", function () {
    this.timeout(5 * 60 * 1000); // 5 minute timeout
    let toolchain: SwiftToolchain;

    setup(async () => {
        toolchain = await SwiftToolchain.create();
    });

    test("No package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("empty-folder"), toolchain);
        assert.strictEqual(spmPackage.foundPackage, false);
    });

    test("Invalid package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("invalid-package"), toolchain);
        assert.strictEqual(spmPackage.foundPackage, true);
        assert.strictEqual(spmPackage.isValid, false);
    });

    test("Library package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package2"), toolchain);
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.libraryProducts.length, 1);
        assert.strictEqual(spmPackage.libraryProducts[0].name, "package2");
        assert.strictEqual(spmPackage.dependencies.length, 0);
        assert.strictEqual(spmPackage.targets.length, 2);
    });

    test("Package resolve v2", async function () {
        if (!toolchain) {
            return;
        }
        if (
            (process.platform === "win32" &&
                toolchain.swiftVersion.isLessThan(new Version(6, 0, 0))) ||
            toolchain.swiftVersion.isLessThan(new Version(5, 6, 0))
        ) {
            this.skip();
        }
        const spmPackage = await SwiftPackage.create(testAssetUri("package5.6"), toolchain);
        assert.strictEqual(spmPackage.isValid, true);
        assert(spmPackage.resolved !== undefined);
    });

    test("Identity case-insensitivity", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("identity-case"), toolchain);
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert(spmPackage.resolved !== undefined);
        assert.strictEqual(spmPackage.resolved.pins.length, 1);
        assert.strictEqual(spmPackage.resolved.pins[0].identity, "yams");
    });

    test("Identity different from name", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("identity-different"), toolchain);
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert(spmPackage.resolved !== undefined);
        assert.strictEqual(spmPackage.resolved.pins.length, 1);
        assert.strictEqual(spmPackage.resolved.pins[0].identity, "swift-log");
    });
});
