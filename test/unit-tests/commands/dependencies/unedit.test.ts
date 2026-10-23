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
import { WorkspaceContext } from "@src/WorkspaceContext";
import { uneditDependency } from "@src/commands/dependencies/unedit";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { SwiftExecOperation, TaskQueue } from "@src/tasks/TaskQueue";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { StatusItem } from "@src/ui/StatusItem";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
} from "../../../MockUtils";

suite("uneditDependency Test Suite", () => {
    const windowMock = mockGlobalObject(vscode, "window");
    const workspaceFoldersMock = mockGlobalValue(vscode.workspace, "workspaceFolders");
    let taskQueue: MockedObject<TaskQueue>;
    let folder: FolderContext;
    let ctx: WorkspaceContext;

    const uncommittedChangesError = {
        stderr: "error: repository '/pkg/Packages/Dep' has uncommitted changes",
    };

    setup(() => {
        workspaceFoldersMock.setValue(undefined);
        taskQueue = mockObject<TaskQueue>({ queueOperation: mockFn() });
        taskQueue.queueOperation.onFirstCall().rejects(uncommittedChangesError);
        taskQueue.queueOperation.resolves(0);
        folder = instance(
            mockObject<FolderContext>({
                name: "pkg",
                taskQueue: instance(taskQueue),
                toolchain: instance(
                    mockObject<SwiftToolchain>({
                        buildFlags: instance(
                            mockObject<BuildFlags>({
                                withAdditionalFlags: mockFn(s => s.returnsArg(0)),
                            })
                        ),
                    })
                ),
            })
        );
        ctx = instance(
            mockObject<WorkspaceContext>({
                logger: instance(
                    mockObject<SwiftLogger>({ trace: mockFn(), debug: mockFn(), error: mockFn() })
                ),
                statusItem: instance(
                    mockObject<StatusItem>({
                        showStatusWhileRunning: mockFn(s => s.callsFake((_, fn) => fn())),
                    })
                ),
                fireEvent: mockFn(s => s.resolves()),
            })
        );
    });

    function queuedArgs(): string[][] {
        return taskQueue.queueOperation
            .getCalls()
            .flatMap(call =>
                call.args[0] instanceof SwiftExecOperation ? [call.args[0].args] : []
            );
    }

    test("forces the unedit when the user confirms losing uncommitted changes", async () => {
        windowMock.showWarningMessage.resolves("Yes" as any);

        const result = await uneditDependency("Dep", ctx, folder);

        expect(queuedArgs()).to.deep.equal([
            ["package", "unedit", "Dep"],
            ["package", "unedit", "--force", "Dep"],
        ]);
        expect(result).to.be.true;
    });

    test("keeps the uncommitted changes when the user answers No", async () => {
        windowMock.showWarningMessage.resolves("No" as any);

        const result = await uneditDependency("Dep", ctx, folder);

        expect(queuedArgs()).to.deep.equal([["package", "unedit", "Dep"]]);
        expect(result).to.be.false;
    });

    test("keeps the uncommitted changes when the user dismisses the prompt", async () => {
        windowMock.showWarningMessage.resolves(undefined);

        const result = await uneditDependency("Dep", ctx, folder);

        expect(queuedArgs()).to.deep.equal([["package", "unedit", "Dep"]]);
        expect(result).to.be.false;
    });
});
