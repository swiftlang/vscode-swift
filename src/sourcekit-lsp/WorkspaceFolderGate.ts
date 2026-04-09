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

import { SwiftLogger } from "../logging/SwiftLogger";
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

    constructor(
        rootUri: vscode.Uri,
        private logger?: SwiftLogger
    ) {
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

        this.logger?.info(
            `WorkspaceFolderGate: Deferring request for ${documentUri.fsPath} until its workspace folder is registered`
        );

        return new Promise<void>(resolve => {
            const timeoutHandle = setTimeout(() => {
                this.logger?.info(
                    `WorkspaceFolderGate: Timed out waiting for folder containing ${documentUri.fsPath}`
                );
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
        this.logger?.info(`WorkspaceFolderGate: Registering folder ${folderUri.fsPath}`);
        this.knownFolders = new Set([...this.knownFolders, folderUri.fsPath]);
        this.resolveMatchingRequests(folderUri);
    }

    folderRemoved(folderUri: vscode.Uri): void {
        this.logger?.info(`WorkspaceFolderGate: Unregistering folder ${folderUri.fsPath}`);
        const updated = new Set(this.knownFolders);
        updated.delete(folderUri.fsPath);
        this.knownFolders = updated;
    }

    dispose(): void {
        if (this.pendingRequests.size > 0) {
            this.logger?.info(
                `WorkspaceFolderGate: Disposing with ${this.pendingRequests.size} pending request(s)`
            );
        }
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
