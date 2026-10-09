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
import {
    ClientCapabilities,
    DidChangeWorkspaceFoldersNotification,
    FeatureState,
    InitializeParams,
    State,
    StaticFeature,
    WorkspaceFolder,
    WorkspaceFoldersRequest,
} from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/node";

import { FolderContext } from "../../../FolderContext";
import { SwiftLogger } from "../../../logging/SwiftLogger";
import { Disposable } from "../../../utilities/Disposable";

export class FolderContextFeature implements StaticFeature {
    private folders: FolderContext[] = [];
    private subscriptions: Disposable[] = [];

    public get addedFolders(): FolderContext[] {
        return this.folders.slice();
    }

    constructor(
        private readonly client: LanguageClient,
        private readonly logger?: SwiftLogger
    ) {}

    fillInitializeParams(params: InitializeParams): void {
        params.workspaceFolders = this.folders.map(convertToWorkspaceFolder);
    }

    fillClientCapabilities(capabilities: ClientCapabilities): void {
        capabilities.workspace = capabilities.workspace ?? {};
        capabilities.workspace.workspaceFolders = true;
    }

    initialize(): void {
        this.subscriptions.push(
            this.client.onRequest(WorkspaceFoldersRequest.type, () => {
                return this.folders.map(convertToWorkspaceFolder);
            })
        );
    }

    getState(): FeatureState {
        return { kind: "static" };
    }

    async addFolder(folder: FolderContext): Promise<void> {
        if (this.folders.some(f => f === folder)) {
            this.logger?.trace(`Folder ${folder.name} already added to language client`, {
                label: "SourceKit-LSP",
            });
            return;
        }
        this.folders.push(folder);
        if (this.client.state !== State.Running) {
            this.logger?.trace(
                `Added folder ${folder.name} to language client (not running, state=${State[this.client.state]})`,
                { label: "SourceKit-LSP" }
            );
            return;
        }
        this.logger?.trace(`Sending didChangeWorkspaceFolders: added ${folder.name}`, {
            label: "SourceKit-LSP",
        });
        await this.client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
            event: { added: [convertToWorkspaceFolder(folder)], removed: [] },
        });
    }

    async removeFolder(folder: FolderContext): Promise<void> {
        const index = this.folders.findIndex(f => f === folder);
        if (index < 0) {
            this.logger?.trace(`Folder ${folder.name} not in language client, not removing`, {
                label: "SourceKit-LSP",
            });
            return;
        }
        this.folders.splice(index, 1);
        if (this.client.state !== State.Running) {
            this.logger?.trace(
                `Removed folder ${folder.name} from language client (not running, state=${State[this.client.state]})`,
                { label: "SourceKit-LSP" }
            );
            return;
        }
        this.logger?.trace(`Sending didChangeWorkspaceFolders: removed ${folder.name}`, {
            label: "SourceKit-LSP",
        });
        await this.client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
            event: { added: [], removed: [convertToWorkspaceFolder(folder)] },
        });
    }

    clear(): void {
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
    }
}

function convertToWorkspaceFolder(ctx: FolderContext): WorkspaceFolder {
    return { name: ctx.name, uri: ctx.folder.toString() };
}
