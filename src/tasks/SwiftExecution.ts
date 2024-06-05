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
export class SwiftExecution extends vscode.CustomExecution {
    constructor(
        public readonly command: string,
        public readonly args: string[],
        public readonly options: SwiftExecutionOptions,
        swiftProcess: SwiftProcess = new SwiftPtyProcess(command, args, options)
    ) {
        super(async () => {
            return new SwiftPseudoterminal(swiftProcess, options.presentation || {});
        });
        this.onDidWrite = swiftProcess.onDidWrite;
        this.onDidClose = swiftProcess.onDidClose;
    }

    /**
     * Bubbles up the {@link SwiftProcess.onDidWrite onDidWrite} event
     * from the {@link SwiftProcess}
     *
     * @see {@link SwiftProcess.onDidWrite}
     */
    onDidWrite: vscode.Event<string>;

    /**
     * Bubbles up the {@link SwiftProcess.onDidClose onDidClose} event
     * from the {@link SwiftProcess}
     *
     * @see {@link SwiftProcess.onDidClose}
     */
    onDidClose: vscode.Event<number | void>;
}
