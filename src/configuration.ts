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
import * as os from "os";
import * as path from "path";

export type DebugAdapters = "auto" | "lldb-dap" | "CodeLLDB";
export type SetupCodeLLDBOptions =
    | "prompt"
    | "alwaysUpdateGlobal"
    | "alwaysUpdateWorkspace"
    | "never";
export type CFamilySupportOptions = "enable" | "disable" | "cpptools-inactive";
export type ActionAfterBuildError = "Focus Problems" | "Focus Terminal" | "Do Nothing";
export type OpenAfterCreateNewProjectOptions =
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
    /** Get the underlying debug adapter type requested by the user. */
    readonly debugAdapter: DebugAdapters;
    /** Return path to debug adapter */
    readonly customDebugAdapterPath: string;
    /** Whether or not to disable setting up the debugger */
    readonly disable: boolean;
    /** User choices for updating CodeLLDB settings */
    readonly setupCodeLLDB: SetupCodeLLDBOptions;
}

/** workspace folder configuration */
export interface FolderConfiguration {
    /** Environment variables to set when running tests */
    readonly testEnvironmentVariables: { [key: string]: string };
    /** Extra arguments to set when building tests */
    readonly additionalTestArguments: string[];
    /** search sub-folder of workspace folder for Swift Packages */
    readonly searchSubfoldersForPackages: boolean;
    /** auto-generate launch.json configurations */
    readonly autoGenerateLaunchConfigurations: boolean;
    /** disable automatic running of swift package resolve */
    readonly disableAutoResolve: boolean;
    /** location to save swift-testing attachments */
    readonly attachmentsPath: string;
    /** look up saved permissions for the supplied plugin */
    pluginPermissions(pluginId?: string): PluginPermissionConfiguration;
    /** look up saved arguments for the supplied plugin, or global plugin arguments if no plugin id is provided */
    pluginArguments(pluginId?: string): string[];
}

export interface PluginPermissionConfiguration {
    /** Disable using the sandbox when executing plugins */
    disableSandbox?: boolean;
    /** Allow the plugin to write to the package directory */
    allowWritingToPackageDirectory?: boolean;
    /** Allow the plugin to write to an additional directory or directories  */
    allowWritingToDirectory?: string | string[];
    /**
     * Allow the plugin to make network connections
     * For a list of valid options see:
     * https://github.com/swiftlang/swift-package-manager/blob/0401a2ae55077cfd1f4c0acd43ae0a1a56ab21ef/Sources/Commands/PackageCommands/PluginCommand.swift#L62
     */
    allowNetworkConnections?: string;
}

/**
 * Type-safe wrapper around configuration settings.
 */
const configuration = {
    /** sourcekit-lsp configuration */
    get lsp(): LSPConfiguration {
        return {
            get serverPath(): string {
                return substituteVariablesInString(
                    vscode.workspace
                        .getConfiguration("swift.sourcekit-lsp")
                        .get<string>("serverPath", "")
                );
            },
            get serverArguments(): string[] {
                return vscode.workspace
                    .getConfiguration("swift.sourcekit-lsp")
                    .get<string[]>("serverArguments", [])
                    .map(substituteVariablesInString);
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
        function pluginSetting<T>(
            setting: string,
            pluginId?: string,
            resultIsArray: boolean = false
        ): T | undefined {
            if (!pluginId) {
                // Check for * as a wildcard plugin ID for configurations that want both
                // global arguments as well as specific additional arguments for a plugin.
                const wildcardSetting = pluginSetting(setting, "*", resultIsArray) as T | undefined;
                if (wildcardSetting) {
                    return wildcardSetting;
                }

                // Check if there is a global setting like `"swift.pluginArguments": ["-c", "release"]`
                // that should apply to all plugins.
                const args = vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<T>(setting);

                if (resultIsArray && Array.isArray(args)) {
                    return args;
                } else if (
                    !resultIsArray &&
                    args !== null &&
                    typeof args === "object" &&
                    Object.keys(args).length !== 0
                ) {
                    return args;
                }
                return undefined;
            }

            return vscode.workspace.getConfiguration("swift", workspaceFolder).get<{
                [key: string]: T;
            }>(setting, {})[pluginId];
        }
        return {
            /** Environment variables to set when running tests */
            get testEnvironmentVariables(): { [key: string]: string } {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<{ [key: string]: string }>("testEnvironmentVariables", {});
            },
            /** Extra arguments to pass to swift test and swift build when running and debugging tests. */
            get additionalTestArguments(): string[] {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<string[]>("additionalTestArguments", [])
                    .map(substituteVariablesInString);
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
            get attachmentsPath(): string {
                return substituteVariablesInString(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get<string>("attachmentsPath", "./.build/attachments")
                );
            },
            pluginPermissions(pluginId?: string): PluginPermissionConfiguration {
                return pluginSetting("pluginPermissions", pluginId, false) ?? {};
            },
            pluginArguments(pluginId?: string): string[] {
                return pluginSetting("pluginArguments", pluginId, true) ?? [];
            },
        };
    },

    /** debugger configuration */
    get debugger(): DebuggerConfiguration {
        return {
            get debugAdapter(): DebugAdapters {
                // Use inspect to determine if the user has explicitly set swift.debugger.useDebugAdapterFromToolchain
                const inspectUseDebugAdapterFromToolchain = vscode.workspace
                    .getConfiguration("swift.debugger")
                    .inspect<boolean>("useDebugAdapterFromToolchain");
                let useDebugAdapterFromToolchain =
                    inspectUseDebugAdapterFromToolchain?.workspaceValue ??
                    inspectUseDebugAdapterFromToolchain?.globalValue;
                // On Windows arm64 we enable swift.debugger.useDebugAdapterFromToolchain by default since CodeLLDB does
                // not support this platform and gives an awful error message.
                if (process.platform === "win32" && process.arch === "arm64") {
                    useDebugAdapterFromToolchain = useDebugAdapterFromToolchain ?? true;
                }
                const selectedAdapter = vscode.workspace
                    .getConfiguration("swift.debugger")
                    .get<DebugAdapters>("debugAdapter", "auto");
                switch (selectedAdapter) {
                    case "auto":
                        if (useDebugAdapterFromToolchain !== undefined) {
                            return useDebugAdapterFromToolchain ? "lldb-dap" : "CodeLLDB";
                        }
                        return "auto";
                    default:
                        return selectedAdapter;
                }
            },
            get customDebugAdapterPath(): string {
                return substituteVariablesInString(
                    vscode.workspace.getConfiguration("swift.debugger").get<string>("path", "")
                );
            },
            get disable(): boolean {
                return vscode.workspace
                    .getConfiguration("swift.debugger")
                    .get<boolean>("disable", false);
            },
            get setupCodeLLDB(): SetupCodeLLDBOptions {
                return vscode.workspace
                    .getConfiguration("swift.debugger")
                    .get<SetupCodeLLDBOptions>("setupCodeLLDB", "prompt");
            },
        };
    },
    /** Files and directories to exclude from the code coverage. */
    get excludeFromCodeCoverage(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("excludeFromCodeCoverage", [])
            .map(substituteVariablesInString);
    },
    /** Files and directories to exclude from the Package Dependencies view. */
    get excludePathsFromPackageDependencies(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("excludePathsFromPackageDependencies", []);
    },
    /** Path to folder that include swift executable */
    get path(): string {
        return substituteVariablesInString(
            vscode.workspace.getConfiguration("swift").get<string>("path", "")
        );
    },
    /** Path to folder that include swift runtime */
    get runtimePath(): string {
        return substituteVariablesInString(
            vscode.workspace.getConfiguration("swift").get<string>("runtimePath", "")
        );
    },
    /** Path to custom --sdk */
    get sdk(): string {
        return substituteVariablesInString(
            vscode.workspace.getConfiguration("swift").get<string>("SDK", "")
        );
    },
    set sdk(value: string | undefined) {
        vscode.workspace.getConfiguration("swift").update("SDK", value);
    },
    /** Path to custom --swift-sdk */
    get swiftSDK(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("swiftSDK", "");
    },
    set swiftSDK(value: string | undefined) {
        vscode.workspace.getConfiguration("swift").update("swiftSDK", value);
    },
    /** swift build arguments */
    get buildArguments(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("buildArguments", [])
            .map(substituteVariablesInString);
    },
    get defaultSwiftVersion(): number | undefined {
        return vscode.workspace.getConfiguration("swift").get<number>("script.defaultSwiftVersion");
    },
    /** swift package arguments */
    get packageArguments(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("packageArguments", [])
            .map(substituteVariablesInString);
    },
    /** thread/address sanitizer */
    get sanitizer(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("sanitizer", "off");
    },
    get buildPath(): string {
        return substituteVariablesInString(
            vscode.workspace.getConfiguration("swift").get<string>("buildPath", "")
        );
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
    get backgroundIndexing(): "on" | "off" | "auto" {
        const value = vscode.workspace
            .getConfiguration("swift.sourcekit-lsp")
            .get("backgroundIndexing", "auto");

        // Legacy versions of this setting were a boolean, convert to the new string version.
        if (typeof value === "boolean") {
            return value ? "on" : "off";
        } else {
            return value;
        }
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
    /** Whether or not to disable SwiftPM sandboxing */
    get disableSandbox(): boolean {
        return vscode.workspace.getConfiguration("swift").get<boolean>("disableSandbox", false);
    },
};

const vsCodeVariableRegex = new RegExp(/\$\{(.+?)\}/g);
function substituteVariablesInString(val: string): string {
    return val.replace(vsCodeVariableRegex, (substring: string, varName: string) =>
        typeof varName === "string" ? computeVscodeVar(varName) || substring : substring
    );
}

function computeVscodeVar(varName: string): string | null {
    const workspaceFolder = () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const documentUri = activeEditor.document.uri;
            const folder = vscode.workspace.getWorkspaceFolder(documentUri);
            if (folder) {
                return folder.uri.fsPath;
            }
        }

        // If there is no active editor then return the first workspace folder
        return vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath ?? "";
    };

    // https://code.visualstudio.com/docs/editor/variables-reference
    // Variables to be substituted should be added here.
    const supportedVariables: { [k: string]: () => string } = {
        workspaceFolder,
        workspaceFolderBasename: () => path.basename(workspaceFolder()),
        cwd: () => process.cwd(),
        userHome: () => os.homedir(),
        pathSeparator: () => path.sep,
    };

    return varName in supportedVariables ? supportedVariables[varName]() : null;
}

export default configuration;
