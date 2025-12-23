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
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Version } from "@src/utilities/version";

import { tag } from "../tags";
import { activateExtensionForSuite } from "./utilities/testutilities";

tag("medium").suite("SwiftPackage Test Suite", function () {
    let swiftPackage: SwiftPackage;

    function getFolderContext(ctx: WorkspaceContext, asset: string): FolderContext {
        const folders = ctx.folders.filter(folder => folder.name.endsWith(asset));
        if (folders.length === 0) {
            throw new Error(`Test asset folder ${asset} not found`);
        }
        return folders[0];
    }

    suite("empty-folder", () => {
        const asset = "empty-folder";

        activateExtensionForSuite({
            async setup(ctx) {
                swiftPackage = getFolderContext(ctx, asset).swiftPackage;
            },
            testAssets: [asset],
        });

        test("No package", async () => {
            assert.strictEqual(await swiftPackage.foundPackage, false);
        });
    });

    suite("invalid-package", () => {
        const asset = "invalid-package";

        activateExtensionForSuite({
            async setup(ctx) {
                swiftPackage = getFolderContext(ctx, asset).swiftPackage;
            },
            testAssets: [asset],
        });

        test("Invalid Package", async () => {
            assert.strictEqual(await swiftPackage.foundPackage, true);
            assert.strictEqual(await swiftPackage.isValid, false);
        });
    });

    suite("package2", () => {
        const asset = "package2";
        let folderContext: FolderContext;

        activateExtensionForSuite({
            async setup(ctx) {
                folderContext = getFolderContext(ctx, asset);
                swiftPackage = folderContext.swiftPackage;
            },
            testAssets: [asset],
        });

        test("Library Package", async () => {
            assert.strictEqual(await swiftPackage.isValid, true);
            assert.strictEqual((await swiftPackage.libraryProducts).length, 1);
            assert.strictEqual((await swiftPackage.libraryProducts)[0].name, "package2");
            assert.strictEqual((await swiftPackage.dependencies).length, 0);
            assert.strictEqual((await swiftPackage.targets).length, 2);
        });

        test("Disabled SwiftPM integration returns undefined package", async () => {
            await swiftPackage.reload(folderContext, true);

            assert.strictEqual(await swiftPackage.isValid, false);
            assert.strictEqual(await swiftPackage.foundPackage, false);
            assert.strictEqual((await swiftPackage.executableProducts).length, 0);
            assert.strictEqual((await swiftPackage.libraryProducts).length, 0);
            assert.strictEqual((await swiftPackage.dependencies).length, 0);
            assert.strictEqual((await swiftPackage.targets).length, 0);
        });
    });

    suite("identity-case", () => {
        const asset = "identity-case";

        activateExtensionForSuite({
            async setup(ctx) {
                const folderContext = getFolderContext(ctx, asset);
                if (
                    folderContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 1, 0)) &&
                    folderContext.swiftVersion.isLessThan(new Version(6, 2, 0))
                ) {
                    this.skip();
                }
                swiftPackage = folderContext.swiftPackage;
            },
            testAssets: [asset],
        });

        test("Identity case-insensitivity", async () => {
            assert.strictEqual(await swiftPackage.isValid, true);
            assert.strictEqual((await swiftPackage.dependencies).length, 1);
            assert(swiftPackage.resolved !== undefined);
            assert.strictEqual(swiftPackage.resolved.pins.length, 1);
            assert.strictEqual(swiftPackage.resolved.pins[0].identity, "yams");
        });
    });

    suite("identity-different", () => {
        const asset = "identity-different";

        activateExtensionForSuite({
            async setup(ctx) {
                swiftPackage = getFolderContext(ctx, asset).swiftPackage;
            },
            testAssets: [asset],
        });

        test("Identity case-different", async () => {
            assert.strictEqual(await swiftPackage.isValid, true);
            assert.strictEqual((await swiftPackage.dependencies).length, 1);
            assert(swiftPackage.resolved !== undefined);
            assert.strictEqual(swiftPackage.resolved.pins.length, 1);
            assert.strictEqual(swiftPackage.resolved.pins[0].identity, "swift-log");
        });
    });
});
