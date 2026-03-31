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

import { isPathInsidePath } from "../utilities/filesystem";

const DEFAULT_TIMEOUT_MS = 5000;

type PendingRequest = {
    readonly documentUri: vscode.Uri;
    readonly resolve: () => void;
    readonly cleanup: () => void;
};

export class WorkspaceFolderGate implements vscode.Disposable {
    private knownFolders: Set<string>;
    private pendingRequests: Set<PendingRequest>;

    constructor(rootUri: vscode.Uri) {
        this.knownFolders = new Set([rootUri.fsPath]);
        this.pendingRequests = new Set();
    }

    waitForFolder(
        documentUri: vscode.Uri,
        timeoutMs: number = DEFAULT_TIMEOUT_MS,
        cancellationToken?: vscode.CancellationToken
    ): Promise<void> {
        if (this.isInsideKnownFolder(documentUri)) {
            return Promise.resolve();
        }

        return new Promise<void>(resolve => {
            const timeoutHandle = setTimeout(() => {
                this.removePendingRequest(request);
                resolve();
            }, timeoutMs);

            const tokenListener = cancellationToken?.onCancellationRequested(() => {
                this.removePendingRequest(request);
                resolve();
            });

            const request: PendingRequest = {
                documentUri,
                resolve,
                cleanup: () => {
                    clearTimeout(timeoutHandle);
                    tokenListener?.dispose();
                },
            };

            this.pendingRequests = new Set([...this.pendingRequests, request]);
        });
    }

    folderAdded(folderUri: vscode.Uri): void {
        this.knownFolders = new Set([...this.knownFolders, folderUri.fsPath]);
        this.resolveMatchingRequests(folderUri);
    }

    folderRemoved(folderUri: vscode.Uri): void {
        const updated = new Set(this.knownFolders);
        updated.delete(folderUri.fsPath);
        this.knownFolders = updated;
    }

    dispose(): void {
        for (const request of this.pendingRequests) {
            request.cleanup();
            request.resolve();
        }
        this.pendingRequests = new Set();
    }

    private isInsideKnownFolder(documentUri: vscode.Uri): boolean {
        return [...this.knownFolders].some(folder => isPathInsidePath(documentUri.fsPath, folder));
    }

    private resolveMatchingRequests(folderUri: vscode.Uri): void {
        const remaining = new Set<PendingRequest>();
        for (const request of this.pendingRequests) {
            if (isPathInsidePath(request.documentUri.fsPath, folderUri.fsPath)) {
                request.cleanup();
                request.resolve();
            } else {
                remaining.add(request);
            }
        }
        this.pendingRequests = remaining;
    }

    private removePendingRequest(request: PendingRequest): void {
        request.cleanup();
        const updated = new Set(this.pendingRequests);
        updated.delete(request);
        this.pendingRequests = updated;
    }
}
