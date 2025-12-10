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
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "./FolderContext";
import { LanguageClientManager } from "./sourcekit-lsp/LanguageClientManager";
import { DocCDocumentationRequest, ReIndexProjectRequest } from "./sourcekit-lsp/extensions";
import { Version } from "./utilities/version";

/**
 * References:
 *
 * - `when` clause contexts:
 *   https://code.visualstudio.com/api/references/when-clause-contexts
 */

/** Interface for getting and setting the VS Code Swift extension's context keys */
export interface ContextKeys {
    /**
     * Whether or not the swift extension is activated.
     */
    isActivated: boolean;

    /**
     * Whether the workspace folder contains a Swift package.
     */
    hasPackage: boolean;

    /**
     * Whether the workspace folder contains a Swift package with at least one executable product.
     */
    hasExecutableProduct: boolean;

    /**
     * Whether the Swift package has any dependencies to display in the Package Dependencies view.
     */
    packageHasDependencies: boolean;

    /**
     * Whether the dependencies list is displayed in a nested or flat view.
     */
    flatDependenciesList: boolean;

    /**
     * Whether the Swift package has any plugins.
     */
    packageHasPlugins: boolean;

    /**
     * Whether current active file is in a SwiftPM source target folder
     */
    currentTargetType: string | undefined;

    /**
     * Whether current active file is a Snippet
     */
    fileIsSnippet: boolean;

    /**
     * Whether current active file is a Snippet
     */
    lldbVSCodeAvailable: boolean;

    /**
     * Whether the swift.createNewProject command is available.
     */
    createNewProjectAvailable: boolean;

    /**
     * Whether the SourceKit-LSP server supports reindexing the workspace.
     */
    supportsReindexing: boolean;

    /**
     * Whether the SourceKit-LSP server supports documentation live preview.
     */
    supportsDocumentationLivePreview: boolean;

    /**
     * Whether the installed version of Swiftly can be used to install toolchains from within VS Code.
     */
    supportsSwiftlyInstall: boolean;

    /**
     * Whether the swift.switchPlatform command is available.
     */
    switchPlatformAvailable: boolean;

    /**
     * Sets values for context keys that are enabled/disabled based on the toolchain version in use.
     */
    updateKeysBasedOnActiveVersion(toolchainVersion: Version): void;

    /**
     * Update context keys based on package contents. Call this when folder focus changes.
     */
    updateForFolder(folderContext: FolderContext | null): void;

    /**
     * Update context keys based on current file. Call this when the active file changes.
     */
    updateForFile(
        currentDocument: vscode.Uri | null,
        currentFolder: FolderContext | null,
        languageClientManager: { get(folder: FolderContext): LanguageClientManager }
    ): Promise<void>;

    /**
     * Update hasPlugins context key by checking all folders. Call this when packages are added/removed or plugins change.
     */
    updateForPlugins(folders: FolderContext[]): void;
}

/**
 * Manages the extension's context key values.
 */
export class ContextKeyManager implements ContextKeys {
    private _isActivated = false;
    private _hasPackage = false;
    private _hasExecutableProduct = false;
    private _flatDependenciesList = false;
    private _packageHasDependencies = false;
    private _packageHasPlugins = false;
    private _currentTargetType: string | undefined = undefined;
    private _fileIsSnippet = false;
    private _lldbVSCodeAvailable = false;
    private _createNewProjectAvailable = false;
    private _supportsReindexing = false;
    private _supportsDocumentationLivePreview = false;
    private _supportsSwiftlyInstall = false;
    private _switchPlatformAvailable = false;

    get isActivated(): boolean {
        return this._isActivated;
    }
    set isActivated(value: boolean) {
        this._isActivated = value;
        void vscode.commands.executeCommand("setContext", "swift.isActivated", value);
    }

    get hasPackage(): boolean {
        return this._hasPackage;
    }
    set hasPackage(value: boolean) {
        this._hasPackage = value;
        void vscode.commands.executeCommand("setContext", "swift.hasPackage", value);
    }

    get hasExecutableProduct(): boolean {
        return this._hasExecutableProduct;
    }
    set hasExecutableProduct(value: boolean) {
        this._hasExecutableProduct = value;
        void vscode.commands.executeCommand("setContext", "swift.hasExecutableProduct", value);
    }

    get packageHasDependencies(): boolean {
        return this._packageHasDependencies;
    }
    set packageHasDependencies(value: boolean) {
        this._packageHasDependencies = value;
        void vscode.commands.executeCommand("setContext", "swift.packageHasDependencies", value);
    }

    get flatDependenciesList(): boolean {
        return this._flatDependenciesList;
    }
    set flatDependenciesList(value: boolean) {
        this._flatDependenciesList = value;
        void vscode.commands.executeCommand("setContext", "swift.flatDependenciesList", value);
    }

    get packageHasPlugins(): boolean {
        return this._packageHasPlugins;
    }
    set packageHasPlugins(value: boolean) {
        this._packageHasPlugins = value;
        void vscode.commands.executeCommand("setContext", "swift.packageHasPlugins", value);
    }

    get currentTargetType(): string | undefined {
        return this._currentTargetType;
    }
    set currentTargetType(value: string | undefined) {
        this._currentTargetType = value;
        void vscode.commands.executeCommand(
            "setContext",
            "swift.currentTargetType",
            value ?? "none"
        );
    }

    get fileIsSnippet(): boolean {
        return this._fileIsSnippet;
    }
    set fileIsSnippet(value: boolean) {
        this._fileIsSnippet = value;
        void vscode.commands.executeCommand("setContext", "swift.fileIsSnippet", value);
    }

    get lldbVSCodeAvailable(): boolean {
        return this._lldbVSCodeAvailable;
    }
    set lldbVSCodeAvailable(value: boolean) {
        this._lldbVSCodeAvailable = value;
        void vscode.commands.executeCommand("setContext", "swift.lldbVSCodeAvailable", value);
    }

    get createNewProjectAvailable(): boolean {
        return this._createNewProjectAvailable;
    }
    set createNewProjectAvailable(value: boolean) {
        this._createNewProjectAvailable = value;
        void vscode.commands.executeCommand("setContext", "swift.createNewProjectAvailable", value);
    }

    get supportsReindexing(): boolean {
        return this._supportsReindexing;
    }
    set supportsReindexing(value: boolean) {
        this._supportsReindexing = value;
        void vscode.commands.executeCommand("setContext", "swift.supportsReindexing", value);
    }

    get supportsDocumentationLivePreview(): boolean {
        return this._supportsDocumentationLivePreview;
    }
    set supportsDocumentationLivePreview(value: boolean) {
        this._supportsDocumentationLivePreview = value;
        void vscode.commands.executeCommand(
            "setContext",
            "swift.supportsDocumentationLivePreview",
            value
        );
    }

    get supportsSwiftlyInstall(): boolean {
        return this._supportsSwiftlyInstall;
    }
    set supportsSwiftlyInstall(value: boolean) {
        this._supportsSwiftlyInstall = value;
        void vscode.commands.executeCommand("setContext", "swift.supportsSwiftlyInstall", value);
    }

    get switchPlatformAvailable(): boolean {
        return this._switchPlatformAvailable;
    }
    set switchPlatformAvailable(value: boolean) {
        this._switchPlatformAvailable = value;
        void vscode.commands.executeCommand("setContext", "swift.switchPlatformAvailable", value);
    }

    /**
     * Update context keys based on package contents.
     * Call this when folder focus changes.
     */
    updateForFolder(folderContext: FolderContext | null): void {
        if (!folderContext) {
            this.hasPackage = false;
            this.hasExecutableProduct = false;
            this.packageHasDependencies = false;
            return;
        }

        void Promise.all([
            folderContext.swiftPackage.foundPackage,
            folderContext.swiftPackage.executableProducts,
            folderContext.swiftPackage.dependencies,
        ]).then(([foundPackage, executableProducts, dependencies]) => {
            this.hasPackage = foundPackage;
            this.hasExecutableProduct = executableProducts.length > 0;
            this.packageHasDependencies = dependencies.length > 0;
        });
    }

    /**
     * Update context keys based on current file.
     * Call this when the active file changes.
     */
    async updateForFile(
        currentDocument: vscode.Uri | null,
        currentFolder: FolderContext | null,
        languageClientManager: { get(folder: FolderContext): LanguageClientManager }
    ): Promise<void> {
        if (currentDocument && currentFolder) {
            const target = await currentFolder.swiftPackage.getTarget(currentDocument.fsPath);
            this.currentTargetType = target?.type;
        } else {
            this.currentTargetType = undefined;
        }

        if (currentFolder) {
            const languageClient = languageClientManager.get(currentFolder);
            await languageClient.useLanguageClient(async client => {
                const experimentalCaps = client.initializeResult?.capabilities.experimental;
                if (!experimentalCaps) {
                    this.supportsReindexing = false;
                    this.supportsDocumentationLivePreview = false;
                    return;
                }
                this.supportsReindexing =
                    experimentalCaps[ReIndexProjectRequest.method] !== undefined;
                this.supportsDocumentationLivePreview =
                    experimentalCaps[DocCDocumentationRequest.method] !== undefined;
            });
        }

        this.updateSnippetContextKey(currentDocument, currentFolder);
    }

    /**
     * Update hasPlugins context key by checking all folders.
     * Call this when packages are added/removed or plugins change.
     */
    updateForPlugins(folders: FolderContext[]): void {
        let hasPlugins = false;
        for (const folder of folders) {
            if (folder.swiftPackage.plugins.length > 0) {
                hasPlugins = true;
                break;
            }
        }
        this.packageHasPlugins = hasPlugins;
    }

    /**
     * Update fileIsSnippet context key based on current file location.
     * Private helper called from updateForFile.
     */
    private updateSnippetContextKey(
        currentDocument: vscode.Uri | null,
        currentFolder: FolderContext | null
    ): void {
        if (
            !currentFolder ||
            !currentDocument ||
            currentFolder.swiftVersion.isLessThan({ major: 5, minor: 7, patch: 0 })
        ) {
            this.fileIsSnippet = false;
            return;
        }

        const filename = currentDocument.fsPath;
        const snippetsFolder = path.join(currentFolder.folder.fsPath, "Snippets");
        this.fileIsSnippet = filename.startsWith(snippetsFolder);
    }

    /**
     * Sets values for context keys that are enabled/disabled based on the toolchain version in use.
     */
    updateKeysBasedOnActiveVersion(toolchainVersion: Version): void {
        this.createNewProjectAvailable = toolchainVersion.isGreaterThanOrEqual(
            new Version(5, 8, 0)
        );
        this.switchPlatformAvailable =
            process.platform === "darwin"
                ? toolchainVersion.isGreaterThanOrEqual(new Version(6, 1, 0))
                : false;
    }
}
