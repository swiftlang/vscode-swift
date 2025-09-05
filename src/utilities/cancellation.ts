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

/**
 * An implementation of a `vscode.CancellationTokenSource` that also monitors multiple
 * child tokens for cancellation, and cancels the token sources token when any of the child tokens are cancelled.
 */
export class CompositeCancellationTokenSource
    implements vscode.CancellationTokenSource, vscode.Disposable
{
    private tokenSource: vscode.CancellationTokenSource;
    private disposables: vscode.Disposable[] = [];

    /**
     * Creates a new cancellation token source that is cancelled when any of the provided tokens are cancelled
     * @param tokens The tokens to monitor for cancellation
     */
    public constructor(...tokens: vscode.CancellationToken[]) {
        this.tokenSource = new vscode.CancellationTokenSource();

        // Monitor all provided tokens and cancel this token source when any of them are cancelled
        tokens.forEach(token => {
            const disposable = token.onCancellationRequested(() => {
                this.cancel();
            });
            this.disposables.push(disposable);
        });
    }

    /**
     * The token provided by this source
     */
    public get token(): vscode.CancellationToken {
        return this.tokenSource.token;
    }

    /**
     * Cancels the token
     */
    public cancel(): void {
        this.tokenSource.cancel();
    }

    /**
     * Disposes this cancellation token source
     */
    public dispose(): void {
        this.tokenSource.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
