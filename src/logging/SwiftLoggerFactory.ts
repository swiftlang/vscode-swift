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
import { join } from "path";
import * as vscode from "vscode";

import { TemporaryFolder } from "../utilities/tempFolder";
import { SwiftLogger } from "./SwiftLogger";
import { SwiftOutputChannel } from "./SwiftOutputChannel";

export class SwiftLoggerFactory {
    constructor(public readonly logFolderUri: vscode.Uri) {}

    create(name: string, logFilename: string): SwiftLogger;
    create(name: string, logFilename: string, options: { outputChannel: true }): SwiftOutputChannel;
    create(
        name: string,
        logFilename: string,
        options: { outputChannel: boolean } = { outputChannel: false }
    ): SwiftLogger {
        return options?.outputChannel
            ? new SwiftOutputChannel(name, this.logFilePath(logFilename))
            : new SwiftLogger(name, this.logFilePath(logFilename));
    }

    /**
     * This is mainly only intended for testing purposes
     */
    async temp(name: string): Promise<SwiftLogger> {
        const folder = await TemporaryFolder.create();
        return new SwiftLogger(name, join(folder.path, `${name}.log`));
    }

    private logFilePath(logFilename: string): string {
        return join(this.logFolderUri.fsPath, logFilename);
    }
}
