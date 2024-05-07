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

import * as vscode from "vscode";
import { SwiftProcess } from "./SwiftProcess";
import { SwiftPseudoterminal } from "./SwiftPseudoterminal";

export interface SwiftExecutionOptions extends vscode.ProcessExecutionOptions {
    presentation?: vscode.TaskPresentationOptions;
}

export class SwiftExecution extends vscode.CustomExecution {
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
    }

    onDidWrite: vscode.Event<string>;

    onDidClose: vscode.Event<number | void>;
}
