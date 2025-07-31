//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { SwiftLogger } from "./SwiftLogger";

export class SwiftOutputChannel extends SwiftLogger implements vscode.OutputChannel {
    /**
     * Creates a vscode.OutputChannel that allows for later retrieval of logs.
     * @param name
     */
    constructor(name: string, logFilePath: string, logStoreLinesSize?: number) {
        super(name, logFilePath, logStoreLinesSize);
    }

    append(value: string): void {
        this.info(value, undefined, { append: true });
    }

    appendLine(value: string): void {
        this.info(value);
    }

    replace(value: string): void {
        this.outputChannel.replace(value);
        this.rollingLog.replace(value);
    }

    show(_column?: unknown, preserveFocus?: boolean | undefined): void {
        this.outputChannel.show(preserveFocus);
    }

    hide(): void {
        this.outputChannel.hide();
    }
}
