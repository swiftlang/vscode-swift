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

import { FolderContext } from "@src/FolderContext";
import { SwiftPackage } from "@src/SwiftPackage";
import { Version } from "@src/utilities/version";

import { testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { createMockFolderContext } from "../utilities/mocks";

tag("medium").suite("SwiftPackage Test Suite", function () {
    let folderContext: FolderContext;

    setup(async () => {
        folderContext = await createMockFolderContext("/path/to/toolchain");
    });

    test("No package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("empty-folder"));
        assert.strictEqual(await spmPackage.foundPackage, false);
    });

    test("Invalid package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("invalid-package"));
        assert.strictEqual(await spmPackage.foundPackage, true);
        assert.strictEqual(await spmPackage.isValid, false);
    });

    test("Library package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package2"));
        assert.strictEqual(await spmPackage.isValid, true);
        assert.strictEqual((await spmPackage.libraryProducts).length, 1);
        assert.strictEqual((await spmPackage.libraryProducts)[0].name, "package2");
        assert.strictEqual((await spmPackage.dependencies).length, 0);
        assert.strictEqual((await spmPackage.targets).length, 2);
    });

    test("Package resolve v2", async function () {
        if (
            (process.platform === "win32" &&
                folderContext.toolchain.swiftVersion.isLessThan(new Version(6, 0, 0))) ||
            folderContext.toolchain.swiftVersion.isLessThan(new Version(5, 6, 0))
        ) {
            this.skip();
        }
        const spmPackage = await SwiftPackage.create(testAssetUri("package5.6"));
        assert.strictEqual(await spmPackage.isValid, true);
        assert(spmPackage.resolved !== undefined);
    });

    test("Identity case-insensitivity", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("identity-case"));
        assert.strictEqual(await spmPackage.isValid, true);
        assert.strictEqual((await spmPackage.dependencies).length, 1);
        assert(spmPackage.resolved !== undefined);
        assert.strictEqual(spmPackage.resolved.pins.length, 1);
        assert.strictEqual(spmPackage.resolved.pins[0].identity, "yams");
    });

    test("Identity different from name", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("identity-different"));
        assert.strictEqual(await spmPackage.isValid, true);
        assert.strictEqual((await spmPackage.dependencies).length, 1);
        assert(spmPackage.resolved !== undefined);
        assert.strictEqual(spmPackage.resolved.pins.length, 1);
        assert.strictEqual(spmPackage.resolved.pins[0].identity, "swift-log");
    });

    test("Disabled SwiftPM integration returns empty package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package2"));

        await spmPackage.loadPackageState(folderContext, true);

        assert.strictEqual(await spmPackage.isValid, true);
        assert.strictEqual(await spmPackage.name, "package2"); // derived from folder name
        assert.strictEqual((await spmPackage.executableProducts).length, 0);
        assert.strictEqual((await spmPackage.libraryProducts).length, 0);
        assert.strictEqual((await spmPackage.dependencies).length, 0);
        assert.strictEqual((await spmPackage.targets).length, 0);
    });

    test("Reload with disabled SwiftPM integration returns empty package", async () => {
        const spmPackage = await SwiftPackage.create(testAssetUri("package2"));
        await spmPackage.loadPackageState(folderContext, false);

        // First verify it loaded normally
        assert.strictEqual(await spmPackage.isValid, true);
        assert.strictEqual((await spmPackage.libraryProducts).length, 1);

        // Now reload with disabled integration
        await spmPackage.reload(folderContext, true);
        assert.strictEqual(await spmPackage.isValid, true);
        assert.strictEqual((await spmPackage.libraryProducts).length, 0);
        assert.strictEqual((await spmPackage.dependencies).length, 0);
        assert.strictEqual((await spmPackage.targets).length, 0);
    });
});
