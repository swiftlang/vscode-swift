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

type CFamilySupportOptions = "enable" | "disable" | "cpptools-inactive";
type ActionAfterBuildError = "Focus Problems" | "Focus Terminal" | "Do Nothing";
type OpenAfterCreateNewProjectOptions =
    | "always"
    | "alwaysNewWindow"
    | "whenNoFolderOpen"
    | "prompt";
export type ShowBuildStatusOptions = "never" | "swiftStatus" | "progress" | "notification";
export type DiagnosticCollectionOptions =
    | "onlySwiftc"
    | "onlySourceKit"
    | "keepSwiftc"
    | "keepSourceKit"
    | "keepAll";

/** sourcekit-lsp configuration */
export interface LSPConfiguration {
    /** Path to sourcekit-lsp executable */
    readonly serverPath: string;
    /** Arguments to pass to sourcekit-lsp executable */
    readonly serverArguments: string[];
    /** Are inlay hints enabled */
    readonly inlayHintsEnabled: boolean;
    /** Support C Family source files */
    readonly supportCFamily: CFamilySupportOptions;
    /** Support Languages */
    readonly supportedLanguages: string[];
    /** Is SourceKit-LSP disabled */
    readonly disable: boolean;
}

/** debugger configuration */
export interface DebuggerConfiguration {
    /** Are we using debug adapter provided with Toolchain */
    readonly useDebugAdapterFromToolchain: boolean;
    /** Return path to debug adapter */
    readonly customDebugAdapterPath: string;
}

/** workspace folder configuration */
export interface FolderConfiguration {
    /** Environment variables to set when running tests */
    readonly testEnvironmentVariables: { [key: string]: string };
    /** search sub-folder of workspace folder for Swift Packages */
    readonly searchSubfoldersForPackages: boolean;
    /** auto-generate launch.json configurations */
    readonly autoGenerateLaunchConfigurations: boolean;
    /** disable automatic running of swift package resolve */
    readonly disableAutoResolve: boolean;
}

/**
 * Type-safe wrapper around configuration settings.
 */
const configuration = {
    /** sourcekit-lsp configuration */
    get lsp(): LSPConfiguration {
        return {
            get serverPath(): string {
                return vscode.workspace
                    .getConfiguration("swift.sourcekit-lsp")
                    .get<string>("serverPath", "");
            },
            get serverArguments(): string[] {
                return vscode.workspace
                    .getConfiguration("swift.sourcekit-lsp")
                    .get<string[]>("serverArguments", []);
            },
            get inlayHintsEnabled(): boolean {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<boolean>("inlayHints.enabled", true);
            },
            get supportCFamily(): CFamilySupportOptions {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<CFamilySupportOptions>("support-c-cpp", "cpptools-inactive");
            },
            get supportedLanguages() {
                return vscode.workspace
                    .getConfiguration("swift.sourcekit-lsp")
                    .get("supported-languages", [
                        "swift",
                        "c",
                        "cpp",
                        "objective-c",
                        "objective-cpp",
                    ]);
            },
            get disable(): boolean {
                return vscode.workspace
                    .getConfiguration("swift.sourcekit-lsp")
                    .get<boolean>("disable", false);
            },
        };
    },

    folder(workspaceFolder: vscode.WorkspaceFolder): FolderConfiguration {
        return {
            /** Environment variables to set when running tests */
            get testEnvironmentVariables(): { [key: string]: string } {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<{ [key: string]: string }>("testEnvironmentVariables", {});
            },
            /** auto-generate launch.json configurations */
            get autoGenerateLaunchConfigurations(): boolean {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<boolean>("autoGenerateLaunchConfigurations", true);
            },
            /** disable automatic running of swift package resolve */
            get disableAutoResolve(): boolean {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<boolean>("disableAutoResolve", false);
            },
            /** search sub-folder of workspace folder for Swift Packages */
            get searchSubfoldersForPackages(): boolean {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<boolean>("searchSubfoldersForPackages", false);
            },
        };
    },

    /** debugger configuration */
    get debugger(): DebuggerConfiguration {
        return {
            /** Should we use the debug adapter included in the Toolchain or CodeLLDB */
            get useDebugAdapterFromToolchain(): boolean {
                return vscode.workspace
                    .getConfiguration("swift.debugger")
                    .get<boolean>("useDebugAdapterFromToolchain", false);
            },
            get customDebugAdapterPath(): string {
                return vscode.workspace.getConfiguration("swift.debugger").get<string>("path", "");
            },
        };
    },
    /** Files and directories to exclude from the code coverage. */
    get excludeFromCodeCoverage(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("excludeFromCodeCoverage", []);
    },
    /** Files and directories to exclude from the Package Dependencies view. */
    get excludePathsFromPackageDependencies(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("excludePathsFromPackageDependencies", []);
    },
    /** Path to folder that include swift executable */
    get path(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("path", "");
    },
    /** Path to folder that include swift runtime */
    get runtimePath(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("runtimePath", "");
    },
    /** Path to custom swift sdk */
    get sdk(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("SDK", "");
    },
    set sdk(value: string | undefined) {
        vscode.workspace.getConfiguration("swift").update("SDK", value);
    },
    /** swift build arguments */
    get buildArguments(): string[] {
        return vscode.workspace.getConfiguration("swift").get<string[]>("buildArguments", []);
    },
    /** thread/address sanitizer */
    get sanitizer(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("sanitizer", "off");
    },
    get buildPath(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("buildPath", "");
    },
    get disableSwiftPMIntegration(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("disableSwiftPackageManagerIntegration", false);
    },
    /** Environment variables to set when building */
    get swiftEnvironmentVariables(): { [key: string]: string } {
        return vscode.workspace
            .getConfiguration("swift")
            .get<{ [key: string]: string }>("swiftEnvironmentVariables", {});
    },
    /** include build errors in problems view */
    get diagnosticsCollection(): DiagnosticCollectionOptions {
        return vscode.workspace
            .getConfiguration("swift")
            .get<DiagnosticCollectionOptions>("diagnosticsCollection", "keepSourceKit");
    },
    /** set the -diagnostic-style option when running `swift` tasks */
    get diagnosticsStyle(): "default" | "llvm" | "swift" {
        return vscode.workspace.getConfiguration("swift").get("diagnosticsStyle", "llvm");
    },
    /** where to show the build progress for the running task */
    get showBuildStatus(): ShowBuildStatusOptions {
        return vscode.workspace
            .getConfiguration("swift")
            .get<ShowBuildStatusOptions>("showBuildStatus", "swiftStatus");
    },
    /** background compilation */
    get backgroundCompilation(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("backgroundCompilation", false);
    },
    /** background indexing */
    get backgroundIndexing(): boolean {
        return vscode.workspace
            .getConfiguration("swift.sourcekit-lsp")
            .get("backgroundIndexing", false);
    },
    /** focus on problems view whenever there is a build error */
    get actionAfterBuildError(): ActionAfterBuildError {
        return vscode.workspace
            .getConfiguration("swift")
            .get<ActionAfterBuildError>("actionAfterBuildError", "Focus Terminal");
    },
    /** output additional diagnostics */
    get diagnostics(): boolean {
        return vscode.workspace.getConfiguration("swift").get<boolean>("diagnostics", false);
    },
    /**
     *  Test coverage settings
     */
    /** Should test coverage report be displayed after running test coverage */
    get displayCoverageReportAfterRun(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("coverage.displayReportAfterRun", true);
    },
    get alwaysShowCoverageStatusItem(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("coverage.alwaysShowStatusItem", true);
    },
    get coverageHitColorLightMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.lightMode.hit", "#c0ffc0");
    },
    get coverageMissColorLightMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.lightMode.miss", "#ffc0c0");
    },
    get coverageHitColorDarkMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.darkMode.hit", "#003000");
    },
    get coverageMissColorDarkMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.darkMode.miss", "#400000");
    },
    get openAfterCreateNewProject(): OpenAfterCreateNewProjectOptions {
        return vscode.workspace
            .getConfiguration("swift")
            .get<OpenAfterCreateNewProjectOptions>("openAfterCreateNewProject", "prompt");
    },
    /** Whether or not the extension should warn about being unable to create symlinks on Windows */
    get warnAboutSymlinkCreation(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("warnAboutSymlinkCreation", true);
    },
    set warnAboutSymlinkCreation(value: boolean) {
        vscode.workspace
            .getConfiguration("swift")
            .update("warnAboutSymlinkCreation", value, vscode.ConfigurationTarget.Global);
    },
    /** Whether or not the extension will contribute Swift environment variables to the integrated terminal */
    get enableTerminalEnvironment(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("enableTerminalEnvironment", true);
    },
};

export default configuration;
