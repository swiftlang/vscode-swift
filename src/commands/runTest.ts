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

export async function runTest(ctx: WorkspaceContext, testKind: TestKind, test: vscode.TestItem) {
    const testExplorer = ctx.currentFolder?.testExplorer;
    if (testExplorer === undefined) {
        ctx.logger.debug("No test explorer for current folder, not running tests", {
            label: "runTest",
        });
        return;
    }

    const profile = testExplorer.testRunProfiles.find(profile => profile.label === testKind);
    if (profile === undefined) {
        ctx.logger.debug(`No test run profile for ${testKind}, not running tests`, {
            label: "runTest",
        });
        return;
    }

    const tokenSource = new vscode.CancellationTokenSource();
    ctx.logger.trace(`Running ${test.id} with ${testKind} profile`, { label: "runTest" });
    await profile.runHandler(
        new vscode.TestRunRequest([test], undefined, profile),
        tokenSource.token
    );
    ctx.logger.trace(`Finished running ${test.id}`, { label: "runTest" });

    await vscode.commands.executeCommand("testing.showMostRecentOutput");
}
