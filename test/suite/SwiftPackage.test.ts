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
    }).timeout(5000);

    test("Invalid package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("invalid-package"));
        assert.strictEqual(spmPackage.foundPackage, true);
        assert.strictEqual(spmPackage.isValid, false);
    }).timeout(5000);

    test("Executable package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package1"));
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.executableProducts.length, 1);
        assert.strictEqual(spmPackage.executableProducts[0].name, "package1");
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert.strictEqual(spmPackage.targets.length, 2);
        assert(spmPackage.resolved !== undefined);
    }).timeout(5000);

    test("Library package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package2"));
        assert.strictEqual(spmPackage.isValid, true);
        assert.strictEqual(spmPackage.libraryProducts.length, 1);
        assert.strictEqual(spmPackage.libraryProducts[0].name, "package2");
        assert.strictEqual(spmPackage.dependencies.length, 0);
        assert.strictEqual(spmPackage.targets.length, 2);
    }).timeout(5000);

    test("Package resolve v2", async () => {
        if (toolchain && toolchain.swiftVersion < new Version(5, 6, 0)) {
            return;
        }
        const spmPackage = await SwiftPackage.create(testAssetUri("package5.6"));
        assert.strictEqual(spmPackage.isValid, true);
        assert(spmPackage.resolved !== undefined);
    }).timeout(5000);
});
