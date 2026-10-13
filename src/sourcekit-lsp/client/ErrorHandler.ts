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
import * as vscode from "vscode";
import {
    CloseAction,
    CloseHandlerResult,
    ErrorAction,
    ErrorHandler,
    ErrorHandlerResult,
    Message,
} from "vscode-languageclient";

import { SwiftLogger } from "../../logging/SwiftLogger";

/**
 * SourceKit-LSP error handler. Copy of the default error handler, except it includes
 * an error message that asks if you want to restart the sourcekit-lsp server again
 * after so many crashes
 */
export class SourceKitLSPErrorHandler implements ErrorHandler {
    private restarts: number[];

    constructor(
        private maxRestartCount: number,
        private logger?: SwiftLogger
    ) {
        this.restarts = [];
    }

    async error(
        _error: Error,
        _message: Message | undefined,
        count: number | undefined
    ): Promise<ErrorHandlerResult> {
        if (count && count <= 3) {
            this.logger?.trace(`Connection error (count=${count}), continuing=${_error.message}`, {
                label: "SourceKit-LSP",
            });
            return { action: ErrorAction.Continue };
        }
        this.logger?.debug(`Connection error (count=${count}), shutting down: ${_error.message}`, {
            label: "SourceKit-LSP",
        });
        return { action: ErrorAction.Shutdown };
    }

    async closed(): Promise<CloseHandlerResult> {
        this.restarts.push(Date.now());
        if (this.restarts.length <= this.maxRestartCount) {
            this.logger?.debug(
                `Connection closed, restarting (restart ${this.restarts.length} of ${this.maxRestartCount})`,
                { label: "SourceKit-LSP" }
            );
            return { action: CloseAction.Restart };
        } else {
            const diff = this.restarts[this.restarts.length - 1] - this.restarts[0];
            if (diff <= 3 * 60 * 1000) {
                this.logger?.debug(
                    `Connection closed, too many restarts in ${diff}ms, prompting user`,
                    { label: "SourceKit-LSP" }
                );
                return new Promise<CloseHandlerResult>(resolve => {
                    void vscode.window
                        .showErrorMessage(
                            `The SourceKit-LSP server crashed ${
                                this.maxRestartCount + 1
                            } times in the last 3 minutes. See the output for more information. Do you want to restart it again.`,
                            "Yes",
                            "No"
                        )
                        .then(result => {
                            this.logger?.debug(`Restart prompt result: ${result}`, {
                                label: "SourceKit-LSP",
                            });
                            if (result === "Yes") {
                                this.restarts = [];
                                resolve({ action: CloseAction.Restart });
                            } else {
                                resolve({ action: CloseAction.DoNotRestart });
                            }
                        });
                });
            } else {
                this.logger?.debug("Connection closed, restarting", { label: "SourceKit-LSP" });
                this.restarts.shift();
                return { action: CloseAction.Restart };
            }
        }
    }
}
