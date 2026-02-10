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

/** The identifier for the Swift extension as it appears in the VSCode Marketplace and OpenVSX. */
const SWIFT_EXTENSION_ID = "swiftlang.swift-vscode";

/**
 * Retrieves the API for the Swift extension.
 *
 * The Swift extension will be activated if it isn't already.
 */
export async function getSwiftExtensionApi(): Promise<SwiftExtensionApi> {
    const extension = vscode.extensions.getExtension(SWIFT_EXTENSION_ID);
    if (extension === undefined) {
        throw new Error(`Unable to find the Swift extension "${SWIFT_EXTENSION_ID}".`);
    }
    if (!extension.isActive) {
        return await extension.activate();
    }
    return extension.exports;
}

/**
 * External API as exposed by the extension.
 *
 * Use {@link getSwiftExtensionApi} to activate the Swift extension and retrieve its API.
 */
export interface SwiftExtensionApi {
    /**
     * The version number of the Swift Extension API. Follows the semantic versioning standard.
     *
     * This version number is separate from the version number of the Swift Extension itself. It will only be updated
     * when changes are made to the API.
     *
     * This was added to the API in Swift Extension version 2.16.0. Older versions do not provide an API version number.
     */
    readonly version?: Version;

    /** The {@link WorkspaceContext} if it is currently available. */
    readonly workspaceContext?: WorkspaceContext;
}

/** Context containing the state of the Swift extension for the entire workspace. */
export interface WorkspaceContext {
    /** Array of available folders that contain Swift code. */
    readonly folders: FolderContext[];

    /**
     * The folder that currently has focus.
     *
     * Focus changes as files are opened and closed by the user.
     */
    readonly currentFolder: FolderContext | null | undefined;

    /**
     * The document URI that currently has focus.
     *
     * Focus changes as files are opened and closed by the user.
     */
    readonly currentDocument: vscode.Uri | null;

    /** The global toolchain used as the default for this workspace. */
    readonly globalToolchain: SwiftToolchain;

    /** An event that fires when the list of folders has changed. */
    readonly onDidChangeFolders: vscode.Event<FolderEvent>;

    /** An event that fires when a Swift file has changed. */
    readonly onDidChangeSwiftFiles: vscode.Event<SwiftFileEvent>;
}

/** Context containing the state of the Swift extension for a specific folder in the workspace. */
export interface FolderContext {
    /** The name of the folder. */
    readonly name: string;

    /** The relative path of the folder within the workspace. */
    readonly relativePath: string;

    /** The URI of the folder. */
    readonly folder: vscode.Uri;

    /** The VS Code workspace folder that contains this folder. */
    readonly workspaceFolder: vscode.WorkspaceFolder;

    /** Whether this folder is the root folder of the workspace. */
    readonly isRootFolder: boolean;

    /** Reference to the workspace context that contains this folder. */
    readonly workspaceContext: WorkspaceContext;

    /**
     * The toolchain used by this folder.
     *
     * Most of the time this will be identical to {@link WorkspaceContext.globalToolchain}. However, it can be
     * different depending on extension settings and/or the use of a toolchain manager like swiftly.
     */
    readonly toolchain: SwiftToolchain;

    /** The Swift package associated with this folder. */
    readonly swiftPackage: SwiftPackage;
}

/** Represents a version number of the form "{major}.{minor}.{patch}". */
export interface VersionInterface {
    /** The major version number. */
    readonly major: number;

    /** The minor version number. */
    readonly minor: number;

    /** The patch version number. */
    readonly patch: number;
}

/** Represents a version with additional methods for comparing with other versions. */
export interface Version extends VersionInterface {
    /** Whether or not this is a development version that has the suffix "-dev". */
    readonly dev: boolean;

    /** Convert this version number to a string of the form "{major}.{minor}.{patch}". */
    toString(): string;

    /** Whether or not this version is less than the provided version. */
    isLessThan(rhs: VersionInterface): boolean;

    /** Whether or not this version is greater than the provided version. */
    isGreaterThan(rhs: VersionInterface): boolean;

    /** Whether or not this version is less than or equal to the provided version. */
    isLessThanOrEqual(rhs: VersionInterface): boolean;

    /** Whether or not this version is greater than or equal to the provided version. */
    isGreaterThanOrEqual(rhs: VersionInterface): boolean;

    /**
     * Compare this version with another version. The result is an integer:
     *  - **negative**: this version is less than the provided version.
     *  - **zero**: this version is equal to the provided version.
     *  - **positive**: this version is greater than the provided version.
     *
     * This function is primarily used by sorting algorithms.
     *
     * @param rhs The version to compare with.
     * @returns An integer representing the result of the comparison.
     */
    compare(rhs: VersionInterface): number;
}

/**
 * Different entities which are used to manage toolchain installations. Possible values are:
 *  - `xcrun`: An Xcode/CommandLineTools toolchain controlled via the `xcrun` and `xcode-select` utilities on macOS.
 *  - `swiftly`: A toolchain managed by `swiftly`.
 *  - `swiftenv`: A toolchain managed by `swiftenv`.
 *  - `unknown`: This toolchain was installed via a method unknown to the Swift extension.
 */
export type ToolchainManager = "xcrun" | "swiftly" | "swiftenv" | "unknown";

export interface SwiftToolchain {
    /** The manager for this toolchain, if any. See {@link ToolchainManager} for more information. */
    readonly manager: ToolchainManager;

    /** The version number of this Swift toolchain. */
    readonly swiftVersion: Version;

    /** The SDK currently in use by this toolchain. */
    readonly sdk?: string;

    /** The user-specified SDK as configured by the `swift.sdk` setting. */
    readonly customSDK?: string;

    /** The default SDK for this toolchain. */
    readonly defaultSDK?: string;
}

/** Workspace Folder Operation types. */
export const enum FolderOperation {
    /** Package folder has been added. */
    add = "add",
    /** Package folder has been removed. */
    remove = "remove",
    /** Workspace folder has gained focus via a file inside the folder becoming the actively edited file. */
    focus = "focus",
    /** Workspace folder loses focus because another workspace folder gained it. */
    unfocus = "unfocus",
    /** Package.swift has been updated. */
    packageUpdated = "packageUpdated",
    /** Package.resolved has been updated. */
    resolvedUpdated = "resolvedUpdated",
    /** .build/workspace-state.json has been updated. */
    workspaceStateUpdated = "workspaceStateUpdated",
    /** .build/workspace-state.json has been updated. */
    packageViewUpdated = "packageViewUpdated",
    /** Package plugins list has been updated. */
    pluginsUpdated = "pluginsUpdated",
    /** The folder's swift toolchain version has been updated. */
    swiftVersionUpdated = "swiftVersionUpdated",
}

/** Workspace Folder Event. */
export interface FolderEvent {
    /** The type of event that occurred. */
    readonly operation: FolderOperation;

    /** The {@link WorkspaceContext} where the event occurred. */
    readonly workspace: WorkspaceContext;

    /**
     * The {@link FolderContext} that was affected.
     *
     * A null folder's significance depends on the operation. For example, a "focus" event with a null folder indicates that
     * no folder currently has focus. Other events such as "unfocus" will never have a null folder.
     */
    readonly folder: FolderContext | null;
}

/** File Operation types. */
export const enum FileOperation {
    /** The file has been created. */
    created = "created",
    /** The file has been changed. */
    changed = "changed",
    /** The file was deleted. */
    deleted = "deleted",
}

/** Swift File Event */
export interface SwiftFileEvent {
    /** The type of operation that occurred on the file. */
    readonly operation: FileOperation;

    /** The URI of the Swift file that was affected. */
    readonly uri: vscode.Uri;
}

/** Swift Package Manager product information. */
export interface Product {
    /** The name of the product. */
    readonly name: string;

    /** The list of target names that make up this product. */
    readonly targets: string[];
}

/** Swift Package Manager target information. */
export interface Target {
    /** The name of the target. */
    readonly name: string;

    /** The C99-compatible name of the target. */
    readonly c99name: string;

    /** The relative path to the target directory. */
    readonly path: string;

    /** The list of source file paths within the target. */
    readonly sources: string[];

    /** The type of target. */
    readonly type:
        | "executable"
        | "test"
        | "library"
        | "snippet"
        | "plugin"
        | "binary"
        | "system-target"
        | "macro";
}

/** Types of Swift Package Manager targets that can be filtered for. */
export const enum TargetType {
    executable = "executable",
    library = "library",
    test = "test",
}

/** Swift Package Manager dependency */
export interface Dependency {
    /** The unique identifier of the dependency. */
    readonly identity: string;

    /** The type of dependency (optional). */
    readonly type?: string;

    /** The version requirement specification (optional). */
    readonly requirement?: object;

    /** The URL of the dependency repository (optional). */
    readonly url?: string;

    /** The local file system path of the dependency (optional). */
    readonly path?: string;

    /** The nested dependencies of this dependency. */
    readonly dependencies: Dependency[];
}

/** A Swift Package Manager dependency with resolved version information. */
export interface ResolvedDependency extends Dependency {
    /** The resolved version of the dependency. */
    readonly version: string;

    /** The type of the dependency. */
    readonly type: string;

    /** The file system path where the dependency is located. */
    readonly path: string;

    /** The location (URL or path) where the dependency was retrieved from. */
    readonly location: string;

    /** The Git revision hash of the dependency (optional). */
    readonly revision?: string;
}

/** Swift Package.resolved file */
export interface PackageResolved {
    /** Hash of the Package.resolved file contents. */
    readonly fileHash: number;

    /** The list of pinned dependencies. */
    readonly pins: PackageResolvedPin[];

    /** The version format of the Package.resolved file. */
    readonly version: number;
}

/** A pinned dependency entry in a Swift Package.resolved file. */
export interface PackageResolvedPin {
    /** The unique identifier of the pinned dependency. */
    readonly identity: string;

    /** The location (URL or path) of the dependency. */
    readonly location: string;

    /** The state information for this pinned dependency. */
    readonly state: PackageResolvedPinState;
}

/** The state information for a pinned dependency in Package.resolved. */
export interface PackageResolvedPinState {
    /** The Git branch name, if the dependency is pinned to a branch. */
    readonly branch: string | null;

    /** The Git revision hash of the pinned dependency. */
    readonly revision: string;

    /** The semantic version, if the dependency is pinned to a version tag. */
    readonly version: string | null;
}

/** A Swift Package Manager plugin that can be executed. */
export interface PackagePlugin {
    /** The command used to execute the plugin. */
    readonly command: string;

    /** The display name of the plugin. */
    readonly name: string;

    /** The name of the package that provides this plugin. */
    readonly package: string;
}

/**
 * Represents a Swift Package Manager package.
 *
 * Provides access to package information, dependencies, targets, and products.
 */
export interface SwiftPackage {
    /** A promise that resolves to true if a Package.swift file was found. */
    readonly foundPackage: Promise<boolean>;

    /** A promise that resolves to the name of this package. */
    readonly name: Promise<string>;

    /** The URI of the folder containing this package. */
    readonly folder: vscode.Uri;

    /** Array of available package plugins. */
    readonly plugins: PackagePlugin[];

    /** The contents of the Package.resolved if one exists. */
    readonly resolved: PackageResolved | undefined;

    /** A promise that resolves to true if the package is valid. */
    readonly isValid: Promise<boolean>;

    /** A promise that resolves with the error that occurred during package loading, if any. */
    readonly error: Promise<Error | undefined>;

    /** A promise that resolves to the list of package dependencies. */
    readonly dependencies: Promise<Dependency[]>;

    /** A promise that resolves to the array of targets in this Swift package. */
    readonly targets: Promise<Target[]>;

    /**
     * Array of targets in this Swift package.
     *
     * NOTE: The targets may not be loaded yet. It is preferable to use the {@link targets} property
     * which returns a promise that resolves to the targets when they're guaranteed to be available.
     **/
    readonly currentTargets: Target[];

    /** A promise that resolves to the list of executable products. */
    readonly executableProducts: Promise<Product[]>;

    /** A promise that resolves to the list of library products. */
    readonly libraryProducts: Promise<Product[]>;

    /** A promise that resolves to the list of resolved root dependencies. */
    readonly rootDependencies: Promise<ResolvedDependency[]>;

    /**
     * Gets targets filtered by type.
     *
     * @param type The type of targets to retrieve (optional).
     * @returns A promise that resolves to the filtered list of targets.
     */
    getTargets(type?: TargetType): Promise<Target[]>;

    /**
     * Gets the target that contains the specified file.
     *
     * @param file The file path to search for.
     * @returns A promise that resolves to the target containing the file, or undefined if not found.
     */
    getTarget(file: string): Promise<Target | undefined>;

    /**
     * Gets the dependencies of a specified dependency.
     *
     * @param dependency The parent dependency to get dependencies of.
     * @returns The list of dependencies.
     */
    childDependencies(dependency: Dependency): ResolvedDependency[];
}
