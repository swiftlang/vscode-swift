//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { execSwift, getErrorDescription, hashString } from "./utilities/utilities";
import { isPathInsidePath } from "./utilities/filesystem";
import { SwiftToolchain } from "./toolchain/toolchain";
import { BuildFlags } from "./toolchain/BuildFlags";
import { SwiftOutputChannel } from "./ui/SwiftOutputChannel";
import { lineBreakRegex } from "./utilities/tasks";

/** Swift Package Manager contents */
interface PackageContents {
    name: string;
    products: Product[];
    dependencies: Dependency[];
    targets: Target[];
}

/** Swift Package Manager product */
export interface Product {
    name: string;
    targets: string[];
    type: { executable?: null; library?: string[] };
}

export function isAutomatic(product: Product): boolean {
    return (product.type.library || []).includes("automatic");
}

/** Swift Package Manager target */
export interface Target {
    name: string;
    c99name: string;
    path: string;
    sources: string[];
    type: "executable" | "test" | "library" | "snippet" | "plugin" | "binary" | "system-target";
}

/** Swift Package Manager dependency */
export interface Dependency {
    identity: string;
    type?: string;
    requirement?: object;
    url?: string;
    path?: string;
    dependencies: Dependency[];
}

export interface ResolvedDependency extends Dependency {
    version: string;
    type: string;
    path: string;
    location: string;
    revision?: string;
}

/** Swift Package.resolved file */
export class PackageResolved {
    readonly fileHash: number;
    readonly pins: PackageResolvedPin[];
    readonly version: number;

    constructor(fileContents: string) {
        const json = JSON.parse(fileContents);
        const version = <{ version: number }>json;
        this.version = version.version;
        this.fileHash = hashString(fileContents);

        if (this.version === 1) {
            const v1Json = json as PackageResolvedFileV1;
            this.pins = v1Json.object.pins.map(
                pin =>
                    new PackageResolvedPin(
                        this.identity(pin.repositoryURL),
                        pin.repositoryURL,
                        pin.state
                    )
            );
        } else if (this.version === 2 || this.version === 3) {
            const v2Json = json as PackageResolvedFileV2;
            this.pins = v2Json.pins.map(
                pin => new PackageResolvedPin(pin.identity, pin.location, pin.state)
            );
        } else {
            throw Error("Unsupported Package.resolved version");
        }
    }

    // Copied from `PackageIdentityParser.computeDefaultName` in
    // https://github.com/apple/swift-package-manager/blob/main/Sources/PackageModel/PackageIdentity.swift
    identity(url: string): string {
        const file = path.basename(url, ".git");
        return file.toLowerCase();
    }
}

/** Swift Package.resolved file */
export class PackageResolvedPin {
    constructor(
        readonly identity: string,
        readonly location: string,
        readonly state: PackageResolvedPinState
    ) {}
}

/** Swift Package.resolved file */
export interface PackageResolvedPinState {
    branch: string | null;
    revision: string;
    version: string | null;
}

interface PackageResolvedFileV1 {
    object: { pins: PackageResolvedPinFileV1[] };
    version: number;
}

interface PackageResolvedPinFileV1 {
    package: string;
    repositoryURL: string;
    state: PackageResolvedPinState;
}

interface PackageResolvedFileV2 {
    pins: PackageResolvedPinFileV2[];
    version: number;
}

interface PackageResolvedPinFileV2 {
    identity: string;
    location: string;
    state: PackageResolvedPinState;
}

/** workspace-state.json file */
export interface WorkspaceState {
    object: { dependencies: WorkspaceStateDependency[] };
    version: number;
}

/** revision + (branch || version)
 * ref: https://github.com/apple/swift-package-manager/blob/e25a590dc455baa430f2ec97eacc30257c172be2/Sources/Workspace/CheckoutState.swift#L19:L23
 */
export interface CheckoutState {
    revision: string;
    branch: string | null;
    version: string | null;
}

export interface WorkspaceStateDependency {
    packageRef: { identity: string; kind: string; location: string; name: string };
    state: { name: string; path?: string; checkoutState?: CheckoutState; version?: string };
    subpath: string;
}

export interface PackagePlugin {
    command: string;
    name: string;
    package: string;
}

/** Swift Package State
 *
 * Can be package contents, error found when loading package or undefined meaning
 * did not find package
 */
type SwiftPackageState = PackageContents | Error | undefined;

function isPackage(state: SwiftPackageState): state is PackageContents {
    return (state as PackageContents).products !== undefined;
}

function isError(state: SwiftPackageState): state is Error {
    return state instanceof Error;
}

/**
 * Class holding Swift Package Manager Package
 */
export class SwiftPackage {
    public plugins: PackagePlugin[] = [];
    private _contents: SwiftPackageState | undefined;

    /**
     * SwiftPackage Constructor
     * @param folder folder package is in
     * @param contents results of `swift package describe`
     * @param resolved contents of Package.resolved
     */
    private constructor(
        readonly folder: vscode.Uri,
        private contentsPromise: Promise<SwiftPackageState>,
        public resolved: PackageResolved | undefined,
        private workspaceState: WorkspaceState | undefined
    ) {}

    /**
     * Create a SwiftPackage from a folder
     * @param folder folder package is in
     * @returns new SwiftPackage
     */
    public static async create(
        folder: vscode.Uri,
        toolchain: SwiftToolchain
    ): Promise<SwiftPackage> {
        const [resolved, workspaceState] = await Promise.all([
            SwiftPackage.loadPackageResolved(folder),
            SwiftPackage.loadWorkspaceState(folder),
        ]);
        return new SwiftPackage(
            folder,
            SwiftPackage.loadPackage(folder, toolchain),
            resolved,
            workspaceState
        );
    }

    /**
     * Returns the package state once it has loaded.
     * A snapshot of the state is stored in `_contents` after initial resolution.
     */
    private get contents(): Promise<SwiftPackageState> {
        return this.contentsPromise.then(contents => {
            // If `reload` is called immediately its possible for it to resolve
            // before the initial contentsPromise resolution. In that case return
            // the newer loaded `_contents`.
            if (this._contents === undefined) {
                this._contents = contents;
                return contents;
            } else {
                return this._contents;
            }
        });
    }

    /**
     * Run `swift package describe` and return results
     * @param folder folder package is in
     * @returns results of `swift package describe`
     */
    static async loadPackage(
        folder: vscode.Uri,
        toolchain: SwiftToolchain
    ): Promise<SwiftPackageState> {
        try {
            // Use swift package describe to describe the package targets, products, and platforms
            const describe = await execSwift(["package", "describe", "--type", "json"], toolchain, {
                cwd: folder.fsPath,
            });
            const packageState = JSON.parse(
                SwiftPackage.trimStdout(describe.stdout)
            ) as PackageContents;

            // Use swift package show-dependencies to get the dependencies in a tree format
            const dependencies = await execSwift(
                ["package", "show-dependencies", "--format", "json"],
                toolchain,
                {
                    cwd: folder.fsPath,
                }
            );

            packageState.dependencies = JSON.parse(
                SwiftPackage.trimStdout(dependencies.stdout)
            ).dependencies;

            return packageState;
        } catch (error) {
            const execError = error as { stderr: string };
            // if caught error and it begins with "error: root manifest" then there is no Package.swift
            if (
                execError.stderr !== undefined &&
                (execError.stderr.startsWith("error: root manifest") ||
                    execError.stderr.startsWith("error: Could not find Package.swift"))
            ) {
                return undefined;
            } else {
                // otherwise it is an error loading the Package.swift so return `null` indicating
                // we have a package but we failed to load it
                return Error(getErrorDescription(error));
            }
        }
    }

    private static async loadPackageResolved(
        folder: vscode.Uri
    ): Promise<PackageResolved | undefined> {
        try {
            const uri = vscode.Uri.joinPath(folder, "Package.resolved");
            const contents = await fs.readFile(uri.fsPath, "utf8");
            return new PackageResolved(contents);
        } catch {
            // failed to load resolved file return undefined
            return undefined;
        }
    }

    private static async loadPlugins(
        folder: vscode.Uri,
        toolchain: SwiftToolchain,
        outputChannel: SwiftOutputChannel
    ): Promise<PackagePlugin[]> {
        try {
            const { stdout } = await execSwift(["package", "plugin", "--list"], toolchain, {
                cwd: folder.fsPath,
            });
            const plugins: PackagePlugin[] = [];
            const lines = stdout.split(lineBreakRegex).map(item => item.trim());
            for (const line of lines) {
                // ‘generate-documentation’ (plugin ‘Swift-DocC’ in package ‘SwiftDocCPlugin’)
                const pluginMatch = /^‘(.*)’ \(plugin ‘(.*)’ in package ‘(.*)’\)/.exec(line);
                if (pluginMatch) {
                    plugins.push({
                        command: pluginMatch[1],
                        name: pluginMatch[2],
                        package: pluginMatch[3],
                    });
                }
            }
            return plugins;
        } catch (error) {
            outputChannel.appendLine(`Failed to laod plugins: ${error}`);
            // failed to load resolved file return undefined
            return [];
        }
    }

    /**
     * Load workspace-state.json file for swift package
     * @returns Workspace state
     */
    private static async loadWorkspaceState(
        folder: vscode.Uri
    ): Promise<WorkspaceState | undefined> {
        try {
            const uri = vscode.Uri.joinPath(
                vscode.Uri.file(BuildFlags.buildDirectoryFromWorkspacePath(folder.fsPath, true)),
                "workspace-state.json"
            );
            const contents = await fs.readFile(uri.fsPath, "utf8");
            return JSON.parse(contents);
        } catch {
            // failed to load resolved file return undefined
            return undefined;
        }
    }

    /** Reload swift package */
    public async reload(toolchain: SwiftToolchain) {
        const loadedContents = await SwiftPackage.loadPackage(this.folder, toolchain);
        this._contents = loadedContents;
        this.contentsPromise = Promise.resolve(loadedContents);
    }

    /** Reload Package.resolved file */
    public async reloadPackageResolved() {
        this.resolved = await SwiftPackage.loadPackageResolved(this.folder);
    }

    public async reloadWorkspaceState() {
        this.workspaceState = await SwiftPackage.loadWorkspaceState(this.folder);
    }

    public async loadSwiftPlugins(toolchain: SwiftToolchain, outputChannel: SwiftOutputChannel) {
        this.plugins = await SwiftPackage.loadPlugins(this.folder, toolchain, outputChannel);
    }

    /** Return if has valid contents */
    public get isValid(): Promise<boolean> {
        return this.contents.then(contents => isPackage(contents));
    }

    /** Load error */
    public get error(): Promise<Error | undefined> {
        return this.contents.then(contents => (isError(contents) ? contents : undefined));
    }

    /** Did we find a Package.swift */
    public get foundPackage(): Promise<boolean> {
        return this.contents.then(contents => contents !== undefined);
    }

    public get rootDependencies(): Promise<ResolvedDependency[]> {
        // Correlate the root dependencies found in the Package.swift with their
        // checked out versions in the workspace-state.json.
        return this.dependencies.then(dependencies =>
            dependencies.map(dependency => this.resolveDependencyAgainstWorkspaceState(dependency))
        );
    }

    private resolveDependencyAgainstWorkspaceState(dependency: Dependency): ResolvedDependency {
        const workspaceStateDep = this.workspaceState?.object.dependencies.find(
            dep => dep.packageRef.identity === dependency.identity
        );
        return {
            ...dependency,
            version: workspaceStateDep?.state.checkoutState?.version ?? "",
            path: workspaceStateDep
                ? this.dependencyPackagePath(workspaceStateDep, this.folder.fsPath)
                : "",
            type: workspaceStateDep ? this.dependencyType(workspaceStateDep) : "",
            location: workspaceStateDep ? workspaceStateDep.packageRef.location : "",
            revision: workspaceStateDep?.state.checkoutState?.revision ?? "",
        };
    }

    public childDependencies(dependency: Dependency): ResolvedDependency[] {
        return dependency.dependencies.map(dep => this.resolveDependencyAgainstWorkspaceState(dep));
    }

    /**
     *  * Get package source path of dependency
     * `editing`: dependency.state.path ?? workspacePath + Packages/ + dependency.subpath
     * `local`: dependency.packageRef.location
     * `remote`: buildDirectory + checkouts + dependency.packageRef.location
     * @param dependency
     * @param workspaceFolder
     * @return the package path based on the type
     */
    private dependencyPackagePath(
        dependency: WorkspaceStateDependency,
        workspaceFolder: string
    ): string {
        const type = this.dependencyType(dependency);
        if (type === "editing") {
            return (
                dependency.state.path ?? path.join(workspaceFolder, "Packages", dependency.subpath)
            );
        } else if (type === "local") {
            return dependency.state.path ?? dependency.packageRef.location;
        } else {
            // remote
            const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(
                workspaceFolder,
                true
            );
            if (dependency.packageRef.kind === "registry") {
                return path.join(buildDirectory, "registry", "downloads", dependency.subpath);
            } else {
                return path.join(buildDirectory, "checkouts", dependency.subpath);
            }
        }
    }

    /**
     * Get type of WorkspaceStateDependency for displaying in the tree: real version | edited | local
     * @param dependency
     * @return "local" | "remote" | "editing"
     */
    private dependencyType(dependency: WorkspaceStateDependency): "local" | "remote" | "editing" {
        if (dependency.state.name === "edited") {
            return "editing";
        } else if (
            dependency.packageRef.kind === "local" ||
            dependency.packageRef.kind === "fileSystem"
        ) {
            // need to check for both "local" and "fileSystem" as swift 5.5 and earlier
            // use "local" while 5.6 and later use "fileSystem"
            return "local";
        } else {
            return "remote";
        }
    }

    /** getName of Swift Package */
    get name(): Promise<string> {
        return this.contents.then(contents => (contents as PackageContents)?.name ?? "");
    }

    /** array of products in Swift Package */
    private get products(): Promise<Product[]> {
        return this.contents.then(contents => (contents as PackageContents)?.products ?? []);
    }

    /** array of dependencies in Swift Package */
    get dependencies(): Promise<Dependency[]> {
        return this.contents.then(contents => (contents as PackageContents)?.dependencies ?? []);
    }

    /** array of targets in Swift Package */
    get targets(): Promise<Target[]> {
        return this.contents.then(contents => (contents as PackageContents)?.targets ?? []);
    }

    /** array of executable products in Swift Package */
    get executableProducts(): Promise<Product[]> {
        return this.products.then(products =>
            products.filter(product => product.type.executable !== undefined)
        );
    }

    /** array of library products in Swift Package */
    get libraryProducts(): Promise<Product[]> {
        return this.products.then(products =>
            products.filter(product => product.type.library !== undefined)
        );
    }

    /**
     * Array of targets in Swift Package. The targets may not be loaded yet.
     * It is preferable to use the `targets` property that returns a promise that
     * returns the targets when they're guarenteed to be resolved.
     **/
    get currentTargets(): Target[] {
        return (this._contents as unknown as { targets: Target[] })?.targets ?? [];
    }

    /**
     * Return array of targets of a certain type
     * @param type Type of target
     * @returns Array of targets
     */
    async getTargets(type?: TargetType): Promise<Target[]> {
        if (type === undefined) {
            return this.targets;
        } else {
            return this.targets.then(targets => targets.filter(target => target.type === type));
        }
    }

    /**
     * Get target for file
     */
    async getTarget(file: string): Promise<Target | undefined> {
        const filePath = path.relative(this.folder.fsPath, file);
        return this.targets.then(targets =>
            targets.find(target => isPathInsidePath(filePath, target.path))
        );
    }

    private static trimStdout(stdout: string): string {
        // remove lines from `swift package describe` until we find a "{"
        while (!stdout.startsWith("{")) {
            const firstNewLine = stdout.indexOf("\n");
            stdout = stdout.slice(firstNewLine + 1);
        }
        return stdout;
    }
}

export enum TargetType {
    executable = "executable",
    library = "library",
    test = "test",
}
