//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

// import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { anything, objectContaining, spy, verify, when } from "ts-mockito";
import { mockNamespace } from "../../unit-tests/MockUtils";
import { openPackage } from "../../../src/commands/openPackage";
import { Version } from "../../../src/utilities/version";
import * as fs from "../../../src/utilities/filesystem";

suite("OpenPackage Command Test Suite", () => {
    const workspaceMock = mockNamespace(vscode, "workspace");
    const windowMock = mockNamespace(vscode, "window");
    const fsSpy = spy(fs);

    async function runTestWithMockFs(version: Version, expected: string, paths: string[]) {
        const basePath = "/test";
        const expectedPath = path.join(basePath, expected);
        paths.forEach(p => {
            when(fsSpy.fileExists(path.join(basePath, p))).thenResolve(true);
        });
        when(windowMock.showTextDocument(anything())).thenResolve();
        await openPackage(version, vscode.Uri.file(basePath));

        verify(workspaceMock.openTextDocument(objectContaining({ fsPath: expectedPath }))).once();
        verify(windowMock.showTextDocument(anything())).once();
    }

    test("Opens nothing when there is no package.swift", async () => {
        await openPackage(new Version(6, 0, 0), vscode.Uri.file("/test"));

        verify(windowMock.showTextDocument(anything())).never();
    });

    test("Opens Package.swift file", async () => {
        await runTestWithMockFs(new Version(6, 0, 0), "Package.swift", ["Package.swift"]);
    });

    test("Opens Package@swift-6.0.0.swift file", async () => {
        await runTestWithMockFs(new Version(6, 0, 0), "Package@swift-6.0.0.swift", [
            "Package.swift",
            "Package@swift-6.0.0.swift",
        ]);
    });

    test("Opens Package@swift-6.1.2.swift file", async () => {
        await runTestWithMockFs(new Version(6, 1, 2), "Package@swift-6.1.2.swift", [
            "Package.swift",
            "Package@swift-6.swift",
            "Package@swift-6.1.swift",
            "Package@swift-6.1.2.swift",
        ]);
    });
});
