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

import { FolderContext } from "../FolderContext";
import { FolderOperation, WorkspaceContext } from "../WorkspaceContext";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { LSPPlaygroundsDiscovery, Playground } from "./LSPPlaygroundsDiscovery";

export { Playground };

export interface PlaygroundChangeEvent {
    uri: string;
    playgrounds: Playground[];
}

/**
 * Uses document symbol request to keep a running copy of all the test methods
 * in a file. When a file is saved it checks to see if any new methods have been
 * added, or if any methods have been removed and edits the test items based on
 * these results.
 */
export class PlaygroundProvider implements vscode.Disposable {
    private hasFetched: boolean = false;
    private fetchPromise: Promise<Playground[]> | undefined;
    private documentPlaygrounds: Map<string, Playground[]> = new Map();
    private didChangePlaygroundsEmitter: vscode.EventEmitter<PlaygroundChangeEvent> =
        new vscode.EventEmitter();

    constructor(private folderContext: FolderContext) {}

    private get lspPlaygroundDiscovery(): LSPPlaygroundsDiscovery {
        return new LSPPlaygroundsDiscovery(this.folderContext);
    }

    private get logger(): SwiftLogger {
        return this.folderContext.workspaceContext.logger;
    }

    /**
     * Create folder observer that creates a PlaygroundProvider when a folder is added and
     * discovers available playgrounds when the folder is in focus
     * @param workspaceContext Workspace context for extension
     * @returns Observer disposable
     */
    public static observeFolders(workspaceContext: WorkspaceContext): vscode.Disposable {
        return workspaceContext.onDidChangeFolders(({ folder, operation }) => {
            switch (operation) {
                case FolderOperation.add:
                case FolderOperation.packageUpdated:
                    if (folder) {
                        void this.setupPlaygroundProviderForFolder(folder);
                    }
                    break;
            }
        });
    }

    private static async setupPlaygroundProviderForFolder(folder: FolderContext) {
        if (!folder.hasPlaygroundProvider()) {
            folder.addPlaygroundProvider();
        }
        await folder.refreshPlaygroundProvider();
    }

    /**
     * Fetch the full list of playgrounds
     */
    async getWorkspacePlaygrounds(): Promise<Playground[]> {
        if (this.fetchPromise) {
            return await this.fetchPromise;
        } else if (!this.hasFetched) {
            await this.fetch();
        }
        return Array.from(this.documentPlaygrounds.values()).flatMap(v => v);
    }

    onDocumentCodeLens(
        document: vscode.TextDocument,
        codeLens: vscode.CodeLens[] | null | undefined
    ) {
        const playgrounds: Playground[] = (
            codeLens?.map(c => (c.command?.arguments ?? [])[0]) ?? []
        )
            .filter(p => !!p)
            // Convert from LSP TextDocumentPlayground to Playground
            .map(p => ({
                ...p,
                range: undefined,
                location: new vscode.Location(document.uri, p.range),
            }));
        const uri = document.uri.toString();
        if (playgrounds.length > 0) {
            this.documentPlaygrounds.set(uri, playgrounds);
            this.didChangePlaygroundsEmitter.fire({ uri, playgrounds });
        } else {
            if (this.documentPlaygrounds.delete(uri)) {
                this.didChangePlaygroundsEmitter.fire({ uri, playgrounds: [] });
            }
        }
    }

    onDidChangePlaygrounds: vscode.Event<PlaygroundChangeEvent> =
        this.didChangePlaygroundsEmitter.event;

    async fetch() {
        this.hasFetched = true;
        if (this.fetchPromise) {
            await this.fetchPromise;
            return;
        }
        if (
            !configuration.swiftPlayPath &&
            !(await this.lspPlaygroundDiscovery.supportsPlaygrounds())
        ) {
            this.logger.warn(
                `Fetching playgrounds not supported by the language server`,
                this.folderContext.name
            );
            return;
        }
        this.fetchPromise = this.lspPlaygroundDiscovery.getWorkspacePlaygrounds();
        try {
            const playgrounds = await this.fetchPromise;
            this.documentPlaygrounds.clear();
            for (const playground of playgrounds) {
                const uri = playground.location.uri;
                this.documentPlaygrounds.set(
                    uri,
                    (this.documentPlaygrounds.get(uri) ?? []).concat(playground)
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to fetch workspace playgrounds: ${error}`,
                this.folderContext.name
            );
        }
        this.fetchPromise = undefined;
    }

    dispose() {
        this.documentPlaygrounds.clear();
    }
}
