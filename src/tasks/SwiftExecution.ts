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
import * as vscode from "vscode";

import { SwiftProcess, SwiftPtyProcess } from "./SwiftProcess";
import { SwiftPseudoterminal } from "./SwiftPseudoterminal";

export interface SwiftExecutionOptions extends vscode.ProcessExecutionOptions {
    presentation?: vscode.TaskPresentationOptions;
}

/**
 * A custom task execution to use for `swift` tasks. This gives us more
 * control over how the task and `swift` process is executed and allows
 * us to capture and process the output of the `swift` process
 */
export class SwiftExecution extends vscode.CustomExecution implements vscode.Disposable {
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter<
        number | void
    >();
    private disposables: vscode.Disposable[] = [];

    constructor(
        public readonly command: string,
        public readonly args: string[],
        public readonly options: SwiftExecutionOptions,
        private swiftProcess: SwiftProcess | undefined = undefined
    ) {
        super(async () => {
            const createSwiftProcess = () => {
                if (!swiftProcess) {
                    this.swiftProcess = new SwiftPtyProcess(command, args, options);
                    this.listen(this.swiftProcess);
                }
                return this.swiftProcess!;
            };
            return new SwiftPseudoterminal(createSwiftProcess, options.presentation || {});
        });
        if (this.swiftProcess) {
            this.listen(this.swiftProcess);
        }
    }

    private listen(swiftProcess: SwiftProcess) {
        this.dispose();
        this.disposables.push(
            swiftProcess.onDidWrite(e => this.writeEmitter.fire(e)),
            swiftProcess.onDidClose(e => this.closeEmitter.fire(e))
        );
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    /**
     * Bubbles up the {@link SwiftProcess.onDidWrite onDidWrite} event
     * from the {@link SwiftProcess}
     *
     * @see {@link SwiftProcess.onDidWrite}
     */
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    /**
     * Bubbles up the {@link SwiftProcess.onDidClose onDidClose} event
     * from the {@link SwiftProcess}
     *
     * @see {@link SwiftProcess.onDidClose}
     */
    onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

    /**
     * Terminate the underlying executable.
     */
    terminate(signal?: NodeJS.Signals) {
        this.swiftProcess?.terminate(signal);
    }
}
