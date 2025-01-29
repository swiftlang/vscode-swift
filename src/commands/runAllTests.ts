//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { TestKind } from "../TestExplorer/TestKind";
import { WorkspaceContext } from "../WorkspaceContext";
import { flattenTestItemCollection } from "../TestExplorer/TestUtils";

export async function runAllTests(ctx: WorkspaceContext, testKind: TestKind) {
    const testExplorer = ctx.currentFolder?.testExplorer;
    if (testExplorer === undefined) {
        return;
    }

    const profile = testExplorer.testRunProfiles.find(profile => profile.label === testKind);
    if (profile === undefined) {
        return;
    }

    const tests = flattenTestItemCollection(testExplorer.controller.items);
    const tokenSource = new vscode.CancellationTokenSource();
    await profile.runHandler(
        new vscode.TestRunRequest(tests, undefined, profile),
        tokenSource.token
    );

    await vscode.commands.executeCommand("testing.showMostRecentOutput");
}

export async function runAllTestsParallel(ctx: WorkspaceContext) {
    await runAllTests(ctx, TestKind.parallel);
}
