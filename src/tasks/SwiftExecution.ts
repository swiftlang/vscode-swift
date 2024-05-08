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
import * as vscode from "vscode";
import { SwiftProcess } from "./SwiftProcess";
import { SwiftPseudoterminal } from "./SwiftPseudoterminal";

export interface SwiftExecutionOptions extends vscode.ProcessExecutionOptions {
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
 * A custom task execution to use for `swift` tasks. This gives us more
 * control over how the task and `swift` process is executed and allows
 * us to capture and process the output of the `swift` process
 */
export class SwiftExecution extends vscode.CustomExecution {
    private disposables: vscode.Disposable[] = [];
    private didFetchEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter();
    private didProgressEmitter: vscode.EventEmitter<SwiftProgress> = new vscode.EventEmitter();
    private didBuildCompleteEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter();

    constructor(
        public readonly command: string,
        public readonly args: string[],
        public readonly options: SwiftExecutionOptions
    ) {
        const swiftProcess = new SwiftProcess(command, args, options);
        super(async () => {
            return new SwiftPseudoterminal(swiftProcess, options.presentation || {});
        });
        this.onDidWrite = swiftProcess.onDidWrite;
        this.onDidClose = swiftProcess.onDidClose;
        this.disposables.push(
            this.didFetchEmitter,
            this.didProgressEmitter,
            this.didBuildCompleteEmitter,
            this.onDidWrite(data => this.parseEvents(data)),
            this.onDidClose(() => this.disposables.forEach(d => d.dispose()))
        );
    }

    /**
     * Bubbles up the {@link SwiftProcess.onDidWrite onDidWrite} event
     * from the `SwiftProcess`
     *
     * @see {@link SwiftProcess.onDidWrite}
     */
    onDidWrite: vscode.Event<string>;

    /**
     * Bubbles up the {@link SwiftProcess.onDidClose onDidClose} event
     * from the `SwiftProcess`
     *
     * @see {@link SwiftProcess.onDidClose}
     */
    onDidClose: vscode.Event<number | void>;

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
