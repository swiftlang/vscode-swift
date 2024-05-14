//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import stripAnsi = require("strip-ansi");
import * as path from "path";
import * as vscode from "vscode";
import { SwiftExecution } from "./SwiftExecution";

export type SwiftTaskType = "swift" | "swift-plugin";

/**
 * More explicitely typed {@link vscode.TaskDefinition TaskDefinition}
 * for `swift` tasks based on what's mandatory in our `taskDefinitions`
 * contribution in the package.json
 */
export interface SwiftTaskDefinition extends vscode.TaskDefinition {
    type: SwiftTaskType;
    cwd?: string;
    env?: { [key: string]: string };
    presentation?: vscode.TaskPresentationOptions;
}

/**
 * Progress of `swift` build, parsed from the
 * output, ex. `[6/7] Building main.swift`
 */
export interface SwiftProgress {
    completed: number;
    total: number;
}

/**
 * A {@link vscode.Task Task} with event detection and emitting
 * force the running `swift` process
 */
export class SwiftTask extends vscode.Task {
    execution: SwiftExecution;

    private disposables: vscode.Disposable[] = [];
    private didWriteEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter();
    private didCloseEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter();
    private didFetchEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter();
    private didProgressEmitter: vscode.EventEmitter<SwiftProgress> = new vscode.EventEmitter();
    private didBuildCompleteEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter();

    /**
     *
     * @param definition See {@link vscode.Task.definition}
     * @param scope See {@link vscode.Task.scope}
     * @param name See {@link vscode.Task.name}
     * @param detail See {@link vscode.Task.detail}
     * @param source See {@link vscode.Task.source}
     * @param swift The fully resolve path of the `swift` executable to run
     * @param swiftArgs The `swift` runtime arguments to use when spawning the process
     * @param problemMatchers See {@link vscode.Task.problemMatchers}
     */
    constructor(
        definition: SwiftTaskDefinition,
        scope: vscode.WorkspaceFolder | vscode.TaskScope.Global | vscode.TaskScope.Workspace,
        name: string,
        detail: string,
        source: string,
        swift: string,
        swiftArgs: string[],
        problemMatchers?: string | string[],
        execution?: SwiftExecution
    ) {
        super(definition, scope, name, source, problemMatchers);
        this.execution =
            execution ??
            new SwiftExecution(swift, swiftArgs, {
                cwd: this.resolveTaskCwd(definition.cwd),
                env: definition.env,
                presentation: definition.presentation,
            });
        this.detail = detail;
        this.presentationOptions = definition.presentation ?? {};
        this.onDidClose = this.execution.onDidClose;

        this.disposables.push(
            this.didFetchEmitter,
            this.didProgressEmitter,
            this.didBuildCompleteEmitter,
            this.execution.onDidWrite(data => {
                this.didWriteEmitter.fire(data);
                this.parseEvents(data);
            }),
            this.execution.onDidClose(e => {
                this.didCloseEmitter.fire(e);
                this.disposables.forEach(d => d.dispose());
            })
        );
    }

    /**
     * Listen for when the `swift` build is fetching dependencies
     */
    onFetching: vscode.Event<void> = this.didFetchEmitter.event;

    /**
     * Listen to updates for the `swift` build progress, ex. [6/7] ...
     */
    onProgress: vscode.Event<SwiftProgress> = this.didProgressEmitter.event;

    /**
     * Listen for the `swift` build to complete. This is not the same
     * as {@link onDidClose}. This event fires when the build portion
     * completes, but if a `swift run` or `test` command, the process
     * may still be running
     */
    onBuildComplete: vscode.Event<void> = this.didBuildCompleteEmitter.event;

    /**
     * Bubbles up the {@link SwiftExecution.onDidClose onDidClose} event
     * from the {@link SwiftExecution}
     *
     * @see {@link SwiftExecution.onDidClose}
     */
    onDidClose: vscode.Event<number | void>;

    private resolveTaskCwd(cwd?: string): string | undefined {
        const scopeWorkspaceFolder = this.getScopeWorkspaceFolder();
        if (!cwd) {
            return scopeWorkspaceFolder;
        }

        if (path.isAbsolute(cwd)) {
            return cwd;
        } else if (scopeWorkspaceFolder) {
            return path.join(scopeWorkspaceFolder, cwd);
        }
        return cwd;
    }

    private getScopeWorkspaceFolder(): string | undefined {
        if (this.scope !== vscode.TaskScope.Global && this.scope !== vscode.TaskScope.Workspace) {
            const scopeWorkspaceFolder = this.scope as vscode.WorkspaceFolder;
            return scopeWorkspaceFolder.uri.fsPath;
        }
        return;
    }

    private parseEvents(data: string): void {
        const sanitizedData = stripAnsi(data);
        // We'll process data one line at a time, in reverse order
        // since the latest interesting message is all we need to
        // be concerned with
        const lines = sanitizedData.split(/\r\n|\n|\r/gm).reverse();
        for (const line of lines) {
            if (this.checkIfBuildComplete(line)) {
                this.didBuildCompleteEmitter.fire();
                return;
            }
            const progress = this.findBuildProgress(line);
            if (progress) {
                this.didProgressEmitter.fire(progress);
                return;
            }
            if (this.checkIfFetching(line)) {
                this.didFetchEmitter.fire();
                return;
            }
        }
    }

    private checkIfBuildComplete(line: string): boolean {
        // Output in this format for "build" and "test" commands
        const completeRegex = /^Build complete!/gm;
        let match = completeRegex.exec(line);
        if (match) {
            return true;
        }
        // Output in this format for "run" commands
        const productCompleteRegex = /^Build of product '.*' complete!/gm;
        match = productCompleteRegex.exec(line);
        if (match) {
            return true;
        }
        return false;
    }

    private checkIfFetching(line: string): boolean {
        const fetchRegex = /^Fetching\s/gm;
        return !!fetchRegex.exec(line);
    }

    private findBuildProgress(line: string): SwiftProgress | undefined {
        const buildingRegex = /^\[(\d+)\/(\d+)\]/g;
        const match = buildingRegex.exec(line);
        if (match) {
            return { completed: parseInt(match[1]), total: parseInt(match[2]) };
        }
    }
}
