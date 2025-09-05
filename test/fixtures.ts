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
import * as path from "path";
import * as vscode from "vscode";

import { SwiftExecution } from "@src/tasks/SwiftExecution";
import { SwiftProcess } from "@src/tasks/SwiftProcess";
import { SwiftTask, createSwiftTask } from "@src/tasks/SwiftTaskProvider";
import { SwiftToolchain } from "@src/toolchain/toolchain";

/** Workspace folder class */
class TestWorkspaceFolder implements vscode.WorkspaceFolder {
    constructor(readonly uri: vscode.Uri) {}
    get name(): string {
        return path.basename(this.uri.fsPath);
    }
    get index(): number {
        return 0;
    }
}

export class TestSwiftProcess implements SwiftProcess {
    private readonly spawnEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly errorEmitter: vscode.EventEmitter<Error> = new vscode.EventEmitter<Error>();
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter<
        number | void
    >();

    isSpawned: boolean = false;
    private error?: Error;
    private exitCode?: number;
    private accumulatedOutput: string = "";

    constructor(
        public command: string,
        public args: string[]
    ) {}

    setError(error: Error): void {
        this.error = error;
    }

    spawn(): void {
        this.isSpawned = true;
        if (this.error) {
            this.errorEmitter.fire(this.error);
        } else {
            this.spawnEmitter.fire();
        }
    }

    write(line: string, delimiter: string = "\n"): void {
        const output = `${line}${delimiter}`;
        this.accumulatedOutput += output;
        this.writeEmitter.fire(output);
    }

    close(exitCode: number): void {
        this.exitCode = exitCode;
        this.closeEmitter.fire(exitCode);
        this.dispose();
    }

    terminate(): void {
        this.close(8);
    }

    dispose() {
        [this.spawnEmitter, this.writeEmitter, this.errorEmitter, this.closeEmitter].forEach(d =>
            d.dispose()
        );
    }

    // These instantaneous task processes can lead to some
    // events being missed while running under test

    onDidSpawn: vscode.Event<void> = (listener: () => unknown, ...args) => {
        if (this.isSpawned) {
            listener();
        }
        return this.spawnEmitter.event(listener, ...args);
    };
    onDidWrite: vscode.Event<string> = (listener: (s: string) => unknown, ...args) => {
        if (this.accumulatedOutput) {
            listener(this.accumulatedOutput);
        }
        return this.writeEmitter.event(listener, ...args);
    };
    onDidThrowError: vscode.Event<Error> = (listener: (e: Error) => unknown, ...args) => {
        if (this.isSpawned && this.error) {
            listener(this.error);
        }
        return this.errorEmitter.event(listener, ...args);
    };
    onDidClose: vscode.Event<number | void> = (
        listener: (e: number | void) => unknown,
        ...args
    ) => {
        if (this.exitCode !== undefined) {
            listener(this.exitCode);
        }
        return this.closeEmitter.event(listener, ...args);
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleInput(input: string): void {
        // Do nothing
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setDimensions(dimensions: vscode.TerminalDimensions): void {
        // Do nothing
    }
}

export interface SwiftTaskFixture {
    task: SwiftTask;
    process: TestSwiftProcess;
}

/**
 * @returns the path of a resource in the **test** directory.
 */
export function testAssetPath(name: string): string {
    return path.resolve(__dirname, "../../assets/test", name);
}

/**
 * @returns the {@link vscode.Uri URI} of a resource in the **test** directory.
 */
export function testAssetUri(name: string): vscode.Uri {
    return vscode.Uri.file(testAssetPath(name));
}

/**
 * @returns the {@link vscode.Uri URI} of a resource in the **test** directory.
 */
export function testAssetWorkspaceFolder(name: string): vscode.WorkspaceFolder {
    return new TestWorkspaceFolder(testAssetUri(name));
}

export function testSwiftProcess(command: string, args: string[]): SwiftProcess {
    return new TestSwiftProcess(command, args);
}

export function testSwiftTask(
    command: string,
    args: string[],
    workspaceFolder: vscode.WorkspaceFolder,
    toolchain: SwiftToolchain
): SwiftTaskFixture {
    const process = new TestSwiftProcess(command, args);
    const execution = new SwiftExecution(command, args, {}, process);
    const task = createSwiftTask(
        args,
        "my test task",
        {
            cwd: workspaceFolder.uri,
            scope: workspaceFolder,
        },
        toolchain
    );
    task.execution = execution;
    return {
        task,
        process,
    };
}
