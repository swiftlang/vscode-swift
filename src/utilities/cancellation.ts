//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

/**
 * An implementation of `vscode.CancellationToken` that monitors multiple child
 * tokens and emits on the `onCancellationRequested` event when any of them are cancelled.
 */
export class CompositeCancellationToken implements vscode.CancellationToken, vscode.Disposable {
    private tokens: vscode.CancellationToken[] = [];
    private disposables: vscode.Disposable[] = [];
    private cancellationRequestedEmitter: vscode.EventEmitter<unknown> = new vscode.EventEmitter();
    private cancelled: boolean = false;

    public onCancellationRequested: vscode.Event<unknown> = this.cancellationRequestedEmitter.event;

    public constructor(...tokens: vscode.CancellationToken[]) {
        tokens.forEach(token => this.add(token));
    }

    public get isCancellationRequested(): boolean {
        return this.tokens.find(t => t.isCancellationRequested) !== undefined;
    }

    public add(token: vscode.CancellationToken) {
        this.tokens.push(token);
        this.disposables.push(
            token.onCancellationRequested(e => {
                // Ensure we only trigger once even if multiple children are cancelled.
                if (this.cancelled) {
                    return;
                }
                this.cancelled = true;
                this.cancellationRequestedEmitter.fire(e);
            })
        );
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
