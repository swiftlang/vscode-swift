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
import * as assert from "assert";
import * as path from "path";
import { anything, deepEqual, verify, when } from "ts-mockito";
import { newSwiftFile } from "../../../src/commands/newFile";
import { mockNamespace } from "../../unit-tests/MockUtils";
import { TemporaryFolder } from "../../../src/utilities/tempFolder";
import { fileExists } from "../../../src/utilities/filesystem";

suite("NewFile Command Test Suite", () => {
    const workspaceMock = mockNamespace(vscode, "workspace");
    const windowMock = mockNamespace(vscode, "window");
    const languagesMock = mockNamespace(vscode, "languages");

    test("Creates a blank file if no URI is provided", async () => {
        await newSwiftFile(undefined);

        verify(workspaceMock.openTextDocument(deepEqual({ language: "swift" }))).once();
        verify(windowMock.showTextDocument(anything())).once();
    });

    test("Creates file at provided directory", async () => {
        const folder = await TemporaryFolder.create();
        const file = path.join(folder.path, "MyFile.swift");

        when(windowMock.showSaveDialog(anything())).thenReturn(
            Promise.resolve(vscode.Uri.file(file))
        );

        await newSwiftFile(vscode.Uri.file(folder.path), () => Promise.resolve(true));

        assert.ok(await fileExists(file));

        verify(workspaceMock.openTextDocument(anything())).once();
        verify(languagesMock.setTextDocumentLanguage(anything(), "swift")).once();
        verify(windowMock.showTextDocument(anything())).once();
    });
});
