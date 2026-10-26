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
import { TaskQueue } from "@src/tasks/TaskQueue";

import { instance, mockObject } from "../../MockUtils";
import { TestLogger } from "../../utilities/TestLogger";

type FakeOperationOptions = {
    name: string;
    checkAlreadyRunning?: boolean;
    result?: () => Promise<number | undefined>;
};

class FakeOperation {
    readonly statusItemId = "fake";
    readonly isBuildOperation = false;
    readonly name: string;
    readonly id: string;
    readonly options: { showStatusItem: boolean; checkAlreadyRunning: boolean };
    private readonly result: () => Promise<number | undefined>;
    runCount = 0;

    constructor({
        name,
        checkAlreadyRunning = false,
        result = () => Promise.resolve(0),
    }: FakeOperationOptions) {
        this.name = name;
        this.id = name;
        this.options = { showStatusItem: false, checkAlreadyRunning };
        this.result = result;
    }

    run(
        _workspaceContext: WorkspaceContext,
        token: vscode.CancellationToken | undefined
    ): Promise<number | undefined> {
        this.runCount += 1;
        return token?.isCancellationRequested ? Promise.resolve(undefined) : this.result();
    }
}

suite("TaskQueue Test Suite", () => {
    let taskQueue: TaskQueue;
    let releaseBlocker: () => void;
    let blocker: FakeOperation;

    setup(() => {
        const workspaceContext = instance(
            mockObject<WorkspaceContext>({ logger: new TestLogger() })
        );
        taskQueue = new TaskQueue(
            instance(mockObject<FolderContext>({ name: "folder", workspaceContext }))
        );
        releaseBlocker = () => {};
        blocker = new FakeOperation({
            name: "blocker",
            result: () =>
                new Promise(resolve => {
                    releaseBlocker = () => resolve(0);
                }),
        });
    });

    teardown(() => {
        taskQueue.dispose();
    });

    function nextTick(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    test("reuses the running operation when checkAlreadyRunning is set", async () => {
        const resolve = new FakeOperation({ name: "resolve", checkAlreadyRunning: true });

        const results = await Promise.all([
            taskQueue.queueOperation(resolve),
            taskQueue.queueOperation(resolve),
        ]);

        expect(results).to.deep.equal([0, 0]);
        expect(resolve.runCount).to.equal(1);
    });

    test("reuses a queued operation queued with the same token", async () => {
        const blocked = taskQueue.queueOperation(blocker);
        await nextTick();
        const build = new FakeOperation({ name: "build" });

        const results = Promise.all([
            taskQueue.queueOperation(build),
            taskQueue.queueOperation(build),
        ]);
        releaseBlocker();

        expect(await results).to.deep.equal([0, 0]);
        expect(build.runCount).to.equal(1);
        await blocked;
    });

    test("shares a queued operation without a token with a caller that has one", async () => {
        const blocked = taskQueue.queueOperation(blocker);
        await nextTick();
        const build = new FakeOperation({ name: "build" });

        const results = Promise.all([
            taskQueue.queueOperation(build),
            taskQueue.queueOperation(build, new vscode.CancellationTokenSource().token),
        ]);
        releaseBlocker();

        expect(await results).to.deep.equal([0, 0]);
        expect(build.runCount).to.equal(1);
        await blocked;
    });

    test("runs a queued operation again for a caller with a different token", async () => {
        const blocked = taskQueue.queueOperation(blocker);
        await nextTick();
        const build = new FakeOperation({ name: "build" });
        const cancelled = new vscode.CancellationTokenSource();

        const first = taskQueue.queueOperation(build, cancelled.token);
        const second = taskQueue.queueOperation(build);
        cancelled.cancel();
        releaseBlocker();

        expect(await first).to.be.undefined;
        expect(await second).to.equal(0);
        await blocked;
    });
});
