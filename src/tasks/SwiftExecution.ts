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
    private swiftProcess?: SwiftProcess;

    constructor(
        public readonly command: string,
        public readonly args: string[],
        public readonly options: SwiftExecutionOptions
    ) {
        super(async () => {
            return new SwiftPseudoterminal(this.getSwiftProcess(), options.presentation || {});
        });
    }

    onDidWrite: vscode.Event<string> = this.getSwiftProcess().onDidWrite;

    onDidClose: vscode.Event<number | void> = this.getSwiftProcess().onDidClose;

    private getSwiftProcess(): SwiftProcess {
        if (!this.swiftProcess) {
            this.swiftProcess = new SwiftProcess(this.command, this.args, this.options);
        }
        return this.swiftProcess;
    }
}
