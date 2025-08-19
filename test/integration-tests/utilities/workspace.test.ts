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
import * as vscode from "vscode";

import { searchForPackages } from "@src/utilities/workspace";
import { Version } from "../../../src/utilities/version";

suite("Workspace Utilities Test Suite", () => {
    suite("searchForPackages", () => {
        const testSwiftVersion = new Version(5, 9, 0);

        test("ignores excluded file", async () => {
            const folders = await searchForPackages(
                (vscode.workspace.workspaceFolders ?? [])[0]!.uri,
                false,
                true,
                testSwiftVersion
            );

            expect(folders.find(f => f.fsPath.includes("defaultPackage"))).to.not.be.undefined;
            expect(folders.find(f => f.fsPath.includes("excluded"))).to.be.undefined;
        });
    });
});
