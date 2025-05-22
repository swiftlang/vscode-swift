//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { Version } from "./utilities/version";

/**
 * References:
 *
 * - `when` clause contexts:
 *   https://code.visualstudio.com/api/references/when-clause-contexts
 */

/** Interface for getting and setting the VS Code Swift extension's context keys */
interface ContextKeys {
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
     * Whether the swift.switchPlatform command is available.
     */
    switchPlatformAvailable: boolean;

    /**
     * Sets values for context keys that are enabled/disabled based on the toolchain version in use.
     */
    updateKeysBasedOnActiveVersion(toolchainVersion: Version): void;
}

/** Creates the getters and setters for the VS Code Swift extension's context keys. */
function createContextKeys(): ContextKeys {
    let isActivated: boolean = false;
    let hasPackage: boolean = false;
    let hasExecutableProduct: boolean = false;
    let flatDependenciesList: boolean = false;
    let packageHasDependencies: boolean = false;
    let packageHasPlugins: boolean = false;
    let currentTargetType: string | undefined = undefined;
    let fileIsSnippet: boolean = false;
    let lldbVSCodeAvailable: boolean = false;
    let createNewProjectAvailable: boolean = false;
    let supportsReindexing: boolean = false;
    let supportsDocumentationLivePreview: boolean = false;
    let switchPlatformAvailable: boolean = false;

    return {
        updateKeysBasedOnActiveVersion(toolchainVersion: Version) {
            this.createNewProjectAvailable = toolchainVersion.isGreaterThanOrEqual(
                new Version(5, 8, 0)
            );
            this.switchPlatformAvailable =
                process.platform === "darwin"
                    ? toolchainVersion.isGreaterThanOrEqual(new Version(6, 1, 0))
                    : false;
        },

        get isActivated() {
            return isActivated;
        },

        set isActivated(value: boolean) {
            isActivated = value;
            vscode.commands.executeCommand("setContext", "swift.isActivated", value);
        },

        get hasPackage() {
            return hasPackage;
        },

        set hasPackage(value: boolean) {
            hasPackage = value;
            vscode.commands.executeCommand("setContext", "swift.hasPackage", value);
        },

        get hasExecutableProduct() {
            return hasExecutableProduct;
        },

        set hasExecutableProduct(value: boolean) {
            hasExecutableProduct = value;
            vscode.commands.executeCommand("setContext", "swift.hasExecutableTarget", value);
        },

        get packageHasDependencies() {
            return packageHasDependencies;
        },

        set packageHasDependencies(value: boolean) {
            packageHasDependencies = value;
            vscode.commands.executeCommand("setContext", "swift.packageHasDependencies", value);
        },

        get flatDependenciesList() {
            return flatDependenciesList;
        },

        set flatDependenciesList(value: boolean) {
            flatDependenciesList = value;
            vscode.commands.executeCommand("setContext", "swift.flatDependenciesList", value);
        },

        get packageHasPlugins() {
            return packageHasPlugins;
        },

        set packageHasPlugins(value: boolean) {
            packageHasPlugins = value;
            vscode.commands.executeCommand("setContext", "swift.packageHasPlugins", value);
        },

        get currentTargetType() {
            return currentTargetType;
        },

        set currentTargetType(value: string | undefined) {
            currentTargetType = value;
            vscode.commands.executeCommand(
                "setContext",
                "swift.currentTargetType",
                value ?? "none"
            );
        },

        get fileIsSnippet() {
            return fileIsSnippet;
        },

        set fileIsSnippet(value: boolean) {
            fileIsSnippet = value;
            vscode.commands.executeCommand("setContext", "swift.fileIsSnippet", value);
        },

        get lldbVSCodeAvailable() {
            return lldbVSCodeAvailable;
        },

        set lldbVSCodeAvailable(value: boolean) {
            lldbVSCodeAvailable = value;
            vscode.commands.executeCommand("setContext", "swift.lldbVSCodeAvailable", value);
        },

        get createNewProjectAvailable() {
            return createNewProjectAvailable;
        },

        set createNewProjectAvailable(value: boolean) {
            createNewProjectAvailable = value;
            vscode.commands.executeCommand("setContext", "swift.createNewProjectAvailable", value);
        },

        get supportsReindexing() {
            return supportsReindexing;
        },

        set supportsReindexing(value: boolean) {
            supportsReindexing = value;
            vscode.commands.executeCommand("setContext", "swift.supportsReindexing", value);
        },

        get supportsDocumentationLivePreview() {
            return supportsDocumentationLivePreview;
        },

        set supportsDocumentationLivePreview(value: boolean) {
            supportsDocumentationLivePreview = value;
            vscode.commands.executeCommand(
                "setContext",
                "swift.supportsDocumentationLivePreview",
                value
            );
        },

        get switchPlatformAvailable() {
            return switchPlatformAvailable;
        },

        set switchPlatformAvailable(value: boolean) {
            switchPlatformAvailable = value;
            vscode.commands.executeCommand("setContext", "swift.switchPlatformAvailable", value);
        },
    };
}

/**
 * Type-safe wrapper around context keys used in `when` clauses.
 */
const contextKeys: ContextKeys = createContextKeys();

export default contextKeys;
