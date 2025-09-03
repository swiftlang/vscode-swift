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
import { expect } from "chai";
import * as path from "path";
import { match } from "sinon";
import * as vscode from "vscode";

import { newSwiftFile } from "@src/commands/newFile";
import { fileExists } from "@src/utilities/filesystem";
import { TemporaryFolder } from "@src/utilities/tempFolder";

import { mockGlobalObject } from "../../MockUtils";

suite("newSwiftFile Command Test Suite", () => {
    const workspaceMock = mockGlobalObject(vscode, "workspace");
    const windowMock = mockGlobalObject(vscode, "window");
    const languagesMock = mockGlobalObject(vscode, "languages");

    test("Creates a blank file if no URI is provided", async () => {
        await newSwiftFile(undefined);

        expect(workspaceMock.openTextDocument).to.have.been.calledWith({ language: "swift" });
        expect(windowMock.showTextDocument).to.have.been.calledOnce;
    });

    test("Creates file at provided directory", async () => {
        const folder = await TemporaryFolder.create();
        const file = path.join(folder.path, "MyFile.swift");
        windowMock.showSaveDialog.resolves(vscode.Uri.file(file));

        await newSwiftFile(vscode.Uri.file(folder.path), () => Promise.resolve(true));

        await expect(fileExists(file)).to.eventually.be.true;

        expect(workspaceMock.openTextDocument).to.have.been.calledOnce;
        expect(languagesMock.setTextDocumentLanguage).to.have.been.calledOnceWith(
            match.any,
            "swift"
        );
        expect(windowMock.showTextDocument).to.have.been.calledOnce;
    });
});
