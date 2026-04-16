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
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { InternalSwiftExtensionApi } from "../InternalSwiftExtensionApi";
import { FolderOperation } from "../SwiftExtensionApi";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { SwiftLogger } from "../logging/SwiftLogger";
import { Disposable } from "../utilities/Disposable";
import { Swiftly } from "./swiftly";

export class SwiftlyToolchainWatcher implements Disposable {
    public static readonly CHECK_INTERVAL = 2000;

    private subscriptions: Disposable[] = [];
    private workspaceSubscriptions: Disposable[] = [];
    private folderWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

    private globalSwiftVersion: string | undefined;
    private localSwiftVersions: Map<string, string | undefined> = new Map();
    private interval: NodeJS.Timeout | undefined;

    private get logger(): SwiftLogger {
        return this.api.logger;
    }

    constructor(private api: InternalSwiftExtensionApi) {
        // Only run this on platforms supported by Swiftly
        if (!Swiftly.isSupported()) {
            return;
        }

        // Deliberately not awaiting this, as we don't want to block the extension activation.
        this.setup().catch(error => {
            this.logger.error(Error("Failed to setup SwiftlyToolchainWatcher", { cause: error }));
        });
    }

    /**
     * Polls Swiftly to check if the global toolchain has been changed.
     */
    private async setup(): Promise<void> {
        this.subscriptions.push(
            this.api.onDidChangeWorkspaceContext(this.handleWorkspaceContextChanged, this)
        );

        this.globalSwiftVersion = await Swiftly.inUseVersion();
        this.interval = setInterval(() => {
            void this.checkGlobalSwiftlyVersion();
        }, SwiftlyToolchainWatcher.CHECK_INTERVAL);
    }

    private handleWorkspaceContextChanged(workspaceContext: WorkspaceContext): void {
        this.workspaceSubscriptions.forEach(s => s.dispose());
        this.folderWatchers.forEach(fsWatcher => fsWatcher.dispose());
        this.workspaceSubscriptions = [
            workspaceContext.onDidChangeFolders(this.handleFolderContextChanges.bind(this)),
        ];
        this.folderWatchers = new Map();
        this.localSwiftVersions = new Map();
    }

    private async readSwiftVersionFile(folder: FolderContext): Promise<string | undefined> {
        const versionFile = path.join(folder.folder.fsPath, ".swift-version");
        try {
            const contents = await fs.readFile(versionFile, "utf-8");
            return contents.trim();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                this.logger.error(`Failed to read .swift-version file at ${versionFile}: ${error}`);
            }
        }
        return undefined;
    }

    private async handleFolderContextChanges({ folder, operation }: FolderEvent): Promise<void> {
        if (!folder) {
            return;
        }

        switch (operation) {
            case FolderOperation.add: {
                const version = await this.readSwiftVersionFile(folder);
                this.localSwiftVersions.set(folder.folder.fsPath, version);
                const fsWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(folder.folder, ".swift-version")
                );
                fsWatcher.onDidCreate(async () => await this.handleSwiftVersionFileChanged(folder));
                fsWatcher.onDidChange(async () => await this.handleSwiftVersionFileChanged(folder));
                fsWatcher.onDidDelete(async () => await this.handleSwiftVersionFileChanged(folder));
                this.folderWatchers.set(folder.folder.fsPath, fsWatcher);
                break;
            }
            case FolderOperation.remove: {
                this.folderWatchers.get(folder.folder.fsPath)?.dispose();
                this.folderWatchers.delete(folder.folder.fsPath);
                this.localSwiftVersions.delete(folder.folder.fsPath);
                break;
            }
        }
    }

    private async handleSwiftVersionFileChanged(folder: FolderContext): Promise<void> {
        const oldSwiftVersion = this.localSwiftVersions.get(folder.folder.fsPath);
        const newSwiftVersion = await this.readSwiftVersionFile(folder);
        if (!newSwiftVersion) {
            return;
        }

        this.localSwiftVersions.set(folder.folder.fsPath, newSwiftVersion);
        if (!oldSwiftVersion || newSwiftVersion === oldSwiftVersion) {
            return;
        }

        if (folder.toolchain.manager !== "swiftly") {
            return;
        }
        await folder.reloadToolchain();
    }

    private async checkGlobalSwiftlyVersion(): Promise<void> {
        const oldSwiftVersion = this.globalSwiftVersion;
        const newSwiftVersion = await Swiftly.inUseVersion();
        if (!newSwiftVersion) {
            return;
        }

        this.globalSwiftVersion = newSwiftVersion;
        if (!oldSwiftVersion || newSwiftVersion === oldSwiftVersion) {
            return;
        }

        const toolchainManager = this.api.workspaceContext?.globalToolchain.manager ?? "swiftly";
        if (toolchainManager !== "swiftly") {
            return;
        }
        this.api.reloadWorkspaceContext();
    }

    dispose(): void {
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
        this.workspaceSubscriptions.forEach(s => s.dispose());
        this.workspaceSubscriptions = [];
        this.folderWatchers.forEach(fsWatcher => fsWatcher.dispose());
        this.folderWatchers = new Map();
        clearInterval(this.interval);
        this.interval = undefined;
    }
}
