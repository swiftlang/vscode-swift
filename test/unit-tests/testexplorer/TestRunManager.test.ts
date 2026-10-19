//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
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

import { FolderContext } from "@src/FolderContext";
import { TestRunManager } from "@src/TestExplorer/TestRunManager";
import { TestRunProxy } from "@src/TestExplorer/TestRunProxy";
import { WorkspaceContext } from "@src/WorkspaceContext";

import { instance, mockFn, mockObject } from "../../MockUtils";
import { TestLogger } from "../../utilities/TestLogger";

suite("TestRunManager", () => {
    const folder = instance(
        mockObject<FolderContext>({
            name: "folder",
            folder: vscode.Uri.file("/path/to/folder"),
            workspaceContext: instance(mockObject<WorkspaceContext>({ logger: new TestLogger() })),
        })
    );

    const createTestRun = (runId: number) => {
        const completeEmitter = new vscode.EventEmitter<void>();
        const testRun = instance(
            mockObject<TestRunProxy>({
                runId,
                onTestRunComplete: mockFn(s => s.callsFake(completeEmitter.event)),
            })
        );
        return { testRun, complete: () => completeEmitter.fire() };
    };

    test("keeps the replacing run active when the replaced run completes", () => {
        const manager = new TestRunManager();
        const first = createTestRun(1);
        const second = createTestRun(2);

        manager.registerTestRun(first.testRun, folder, new vscode.CancellationTokenSource());
        manager.registerTestRun(second.testRun, folder, new vscode.CancellationTokenSource());
        first.complete();

        expect(manager.getActiveTestRun(folder)).to.equal(second.testRun);
    });

    test("removes the active run when it completes", () => {
        const manager = new TestRunManager();
        const run = createTestRun(1);

        manager.registerTestRun(run.testRun, folder, new vscode.CancellationTokenSource());
        run.complete();

        expect(manager.getActiveTestRun(folder)).to.be.undefined;
    });
});
