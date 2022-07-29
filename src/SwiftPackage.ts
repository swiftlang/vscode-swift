//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import {
    buildDirectoryFromWorkspacePath,
    execSwift,
    getErrorDescription,
} from "./utilities/utilities";

/** Swift Package Manager contents */
export interface PackageContents {
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

/** Swift Package Manager target */
export interface Target {
    name: string;
    path: string;
    sources: string[];
    type: "executable" | "test" | "library";
}

/** Swift Package Manager dependency */
export interface Dependency {
    identity: string;
    type?: string; // fileSystem, sourceControl or registry
    requirement?: object;
    url?: string;
    path?: string;
}

/** Swift Package.resolved file */
export class PackageResolved {
    constructor(readonly pins: PackageResolvedPin[], readonly version: number) {}

    static fromV1JSON(json: PackageResolvedFileV1): PackageResolved {
        return new PackageResolved(
            json.object.pins.map(
                pin => new PackageResolvedPin(pin.package, pin.repositoryURL, pin.state)
            ),
            json.version
        );
    }

    static fromV2JSON(json: PackageResolvedFileV2): PackageResolved {
        return new PackageResolved(
            json.pins.map(pin => new PackageResolvedPin(pin.identity, pin.location, pin.state)),
            json.version
        );
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

/** branch + revision || revision + version */
export interface CheckoutState {
    branch: string | null;
    revision: string;
    version: string | null;
}

export interface WorkspaceStateDependency {
    packageRef: { identity: string; kind: string; location: string; name: string };
    state: { name: string; path?: string; checkoutState?: CheckoutState };
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
 * Get version of WorkspaceStateDependency for displaying in the tree
 * @param dependency
 * @return real version | edited | local
 */
export function dependencyVersion(dependency: WorkspaceStateDependency): string {
    return dependency.packageRef.kind === "fileSystem"
        ? "local"
        : dependency.state.checkoutState?.version ??
              dependency.state.checkoutState?.branch ??
              "edited";
}

/**
 * Get type of WorkspaceStateDependency for displaying in the tree: real version | edited | local
 * @param dependency
 * @return "local" | "remote" | "edited"
 */
export function dependencyType(
    dependency: WorkspaceStateDependency
): "local" | "remote" | "edited" {
    return dependency.state.name === "edited"
        ? "edited"
        : dependency.packageRef.kind === "fileSystem"
        ? "local"
        : "remote";
}

/**
 * Get type of WorkspaceStateDependency for displaying in the tree: real version | edited | local
 * `edited`: dependency.state.path ?? workspacePath + Packages/ + dependency.subpath
 * `local`: dependency.packageRef.location
 * `remote`: buildDirectory + checkouts + dependency.packageRef.location
 * @param dependency
 * @return the package path based on the type
 */
export function dependencyPackagePath(
    dependency: WorkspaceStateDependency,
    workspaceFolder: string
): string {
    const type = dependencyType(dependency);
    let packagePath = "";
    if (type === "edited") {
        packagePath =
            dependency.state.path ?? path.join(workspaceFolder, "Packages", dependency.subpath);
    } else if (type === "local") {
        packagePath = dependency.state.path ?? dependency.packageRef.location;
    } else {
        // remote
        const buildDirectory = buildDirectoryFromWorkspacePath(workspaceFolder, true);
        packagePath = path.join(buildDirectory, "checkouts", dependency.subpath);
    }
    return packagePath;
}

/**
 * Class holding Swift Package Manager Package
 */
export class SwiftPackage implements PackageContents {
    /**
     * SwiftPackage Constructor
     * @param folder folder package is in
     * @param contents results of `swift package describe`
     * @param resolved contents of Package.resolved
     */
    private constructor(
        readonly folder: vscode.Uri,
        private contents: SwiftPackageState,
        public resolved: PackageResolved | undefined,
        public plugins: PackagePlugin[]
    ) {}

    /**
     * Create a SwiftPackage from a folder
     * @param folder folder package is in
     * @returns new SwiftPackage
     */
    static async create(folder: vscode.Uri): Promise<SwiftPackage> {
        const contents = await SwiftPackage.loadPackage(folder);
        const resolved = await SwiftPackage.loadPackageResolved(folder);
        const plugins = await SwiftPackage.loadPlugins(folder);
        return new SwiftPackage(folder, contents, resolved, plugins);
    }

    /**
     * Run `swift package describe` and return results
     * @param folder folder package is in
     * @returns results of `swift package describe`
     */
    static async loadPackage(folder: vscode.Uri): Promise<SwiftPackageState> {
        try {
            let { stdout } = await execSwift(["package", "describe", "--type", "json"], {
                cwd: folder.fsPath,
            });
            // remove lines from `swift package describe` until we find a "{"
            while (!stdout.startsWith("{")) {
                const firstNewLine = stdout.indexOf("\n");
                stdout = stdout.slice(firstNewLine + 1);
            }
            return JSON.parse(stdout);
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

    static async loadPackageResolved(folder: vscode.Uri): Promise<PackageResolved | undefined> {
        try {
            const uri = vscode.Uri.joinPath(folder, "Package.resolved");
            const contents = await fs.readFile(uri.fsPath, "utf8");
            if (contents === undefined) {
                return undefined;
            }
            const json = JSON.parse(contents);
            const version = <{ version: number }>json;
            if (version.version === 1) {
                return PackageResolved.fromV1JSON(json);
            } else if (version.version === 2) {
                return PackageResolved.fromV2JSON(json);
            } else {
                return undefined;
            }
        } catch {
            // failed to load resolved file return undefined
            return undefined;
        }
    }

    static async loadPlugins(folder: vscode.Uri): Promise<PackagePlugin[]> {
        try {
            const { stdout } = await execSwift(["package", "plugin", "--list"], {
                cwd: folder.fsPath,
            });
            const plugins: PackagePlugin[] = [];
            const lines = stdout.split("\n").map(item => item.trim());
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
        } catch {
            // failed to load resolved file return undefined
            return [];
        }
    }

    /**
     * Load workspace-state.json file for swift package
     * @returns Workspace state
     */
    async loadWorkspaceState(): Promise<WorkspaceState | undefined> {
        try {
            const uri = vscode.Uri.joinPath(
                vscode.Uri.file(buildDirectoryFromWorkspacePath(this.folder.fsPath, true)),
                "workspace-state.json"
            );
            const contents = await fs.readFile(uri.fsPath, "utf8");
            return JSON.parse(contents);
        } catch {
            // failed to load resolved file return undefined
            return undefined;
        }
    }

    /**
     * tranverse the dependency tree
     * in each node, call `swift package describe` to get the child dependencies and do it recursively
     * @returns all dependencies in flat list
     */
    async resolveDependencyGraph(): Promise<WorkspaceStateDependency[]> {
        const workspaceState = await this.loadWorkspaceState();
        const workspaceStateDependencies = workspaceState?.object.dependencies ?? [];

        if (workspaceStateDependencies.length === 0) {
            return [];
        }

        const contents = this.contents as PackageContents;
        console.log("== resolve graph begin");
        const showingDependencies = new Set<string>();
        await this.getChildDependencies(contents, workspaceStateDependencies, showingDependencies);

        console.log("== resolve graph done");

        // filter workspaceStateDependencies that in showingDependencies
        return workspaceStateDependencies.filter(dependency =>
            showingDependencies.has(dependency.packageRef.identity)
        );

        // this can filter out dependencies that are not in the workspace state
        // filter workspaceStateDependencies that not in showingDependencies
        //const unusedPackages = workspaceStateDependencies.filter(
        //    dependency => !showingDependencies.has(dependency.packageRef.identity)
        //);
    }

    /**
     * tranverse the dependency tree
     * @param dependency current node
     * @param workspaceStateDependencies all dependencies in workspace-state.json
     * @param showingDependencies result of dependencies that are showing in the tree
     * @returns
     */
    private async getChildDependencies(
        dependency: PackageContents,
        workspaceStateDependencies: WorkspaceStateDependency[],
        showingDependencies: Set<string>
    ) {
        for (let i = 0; i < dependency.dependencies.length; i++) {
            const childDependency = dependency.dependencies[i];
            if (showingDependencies.has(childDependency.identity)) {
                return;
            }
            showingDependencies.add(childDependency.identity);
            const workspaceStateDependency = workspaceStateDependencies.find(
                workspaceStateDependency =>
                    workspaceStateDependency.packageRef.identity === childDependency.identity
            );
            if (workspaceStateDependency) {
                showingDependencies.add(workspaceStateDependency.packageRef.identity);
            }

            if (workspaceStateDependency === undefined) {
                return;
            }

            const packagePath = dependencyPackagePath(workspaceStateDependency, this.folder.fsPath);

            const childDependencyContents = (await SwiftPackage.loadPackage(
                vscode.Uri.file(packagePath)
            )) as PackageContents;

            await this.getChildDependencies(
                childDependencyContents,
                workspaceStateDependencies,
                showingDependencies
            );
        }
    }

    /** Reload swift package */
    public async reload() {
        this.contents = await SwiftPackage.loadPackage(this.folder);
    }

    /** Reload Package.resolved file */
    public async reloadPackageResolved() {
        this.resolved = await SwiftPackage.loadPackageResolved(this.folder);
    }

    /** Return if has valid contents */
    public get isValid(): boolean {
        return isPackage(this.contents);
    }

    /** Load error */
    public get error(): Error | undefined {
        if (isError(this.contents)) {
            return this.contents;
        } else {
            return undefined;
        }
    }

    /** Did we find a Package.swift */
    public get foundPackage(): boolean {
        return this.contents !== undefined;
    }

    /** name of Swift Package */
    get name(): string {
        return (this.contents as PackageContents)?.name ?? "";
    }

    /** array of products in Swift Package */
    get products(): Product[] {
        return (this.contents as PackageContents)?.products ?? [];
    }

    /** array of dependencies in Swift Package */
    get dependencies(): Dependency[] {
        return (this.contents as PackageContents)?.dependencies ?? [];
    }

    /** array of targets in Swift Package */
    get targets(): Target[] {
        return (this.contents as PackageContents)?.targets ?? [];
    }

    /** array of executable products in Swift Package */
    get executableProducts(): Product[] {
        return this.products.filter(product => product.type.executable !== undefined);
    }

    /** array of library products in Swift Package */
    get libraryProducts(): Product[] {
        return this.products.filter(product => product.type.library !== undefined);
    }

    /**
     * Return array of targets of a certain type
     * @param type Type of target
     * @returns Array of targets
     */
    getTargets(type: "executable" | "library" | "test"): Target[] {
        return this.targets.filter(target => target.type === type);
    }
}
