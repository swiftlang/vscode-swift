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
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { WorkspaceContext } from "./WorkspaceContext";
import { SwiftToolchain } from "./toolchain/toolchain";
import { showReloadExtensionNotification } from "./ui/ReloadExtension";

/**
 * Custom error type for configuration validation errors that includes the setting name
 */
export class ConfigurationValidationError extends Error {
    constructor(
        public readonly settingName: string,
        message: string
    ) {
        super(message);
        this.name = "ConfigurationValidationError";
    }
}

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
export type DiagnosticStyle = "default" | "llvm" | "swift";
export type ValidCodeLens = "run" | "debug" | "coverage";

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
    /** Folders to ignore when searching for Swift Packages */
    readonly ignoreSearchingForPackagesInSubfolders: string[];
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

export interface BackgroundCompilationConfiguration {
    /** enable background compilation task on save */
    enabled: boolean;
    /** use the default `swift` build task when background compilation is enabled */
    useDefaultTask: boolean;
    /** Use the `release` variant of the build all task */
    release: boolean;
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
                    validateStringSetting(
                        vscode.workspace
                            .getConfiguration("swift.sourcekit-lsp")
                            .get<string>("serverPath", ""),
                        "swift.sourcekit-lsp.serverPath"
                    )
                );
            },
            get serverArguments(): string[] {
                return validateStringArraySettings(
                    vscode.workspace
                        .getConfiguration("swift.sourcekit-lsp")
                        .get<string[]>("serverArguments", []),
                    "swift.sourcekit-lsp.serverArguments"
                ).map(substituteVariablesInString);
            },
            get inlayHintsEnabled(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("sourcekit-lsp")
                        .get<boolean>("inlayHints.enabled", true),
                    "swift.sourcekit-lsp.inlayHints.enabled"
                );
            },
            get supportCFamily(): CFamilySupportOptions {
                return validateStringSetting(
                    vscode.workspace
                        .getConfiguration("sourcekit-lsp")
                        .get<CFamilySupportOptions>("support-c-cpp", "cpptools-inactive"),
                    "swift.sourcekit-lsp.support-c-cpp"
                );
            },
            get supportedLanguages() {
                return validateStringArraySettings(
                    vscode.workspace
                        .getConfiguration("swift.sourcekit-lsp")
                        .get("supported-languages", [
                            "swift",
                            "c",
                            "cpp",
                            "objective-c",
                            "objective-cpp",
                        ]),
                    "swift.sourcekit-lsp.supported-languages"
                );
            },
            get disable(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift.sourcekit-lsp")
                        .get<boolean>("disable", false),
                    "swift.sourcekit-lsp.disable"
                );
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
                return validateObjectSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get<{ [key: string]: string }>("testEnvironmentVariables", {}),
                    "swift.testEnvironmentVariables"
                );
            },
            /** Extra arguments to pass to swift test and swift build when running and debugging tests. */
            get additionalTestArguments(): string[] {
                return validateStringArraySettings(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get<string[]>("additionalTestArguments", []),
                    "swift.additionalTestArguments"
                ).map(substituteVariablesInString);
            },
            /** auto-generate launch.json configurations */
            get autoGenerateLaunchConfigurations(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get<boolean>("autoGenerateLaunchConfigurations", true),
                    "swift.autoGenerateLaunchConfigurations"
                );
            },
            /** disable automatic running of swift package resolve */
            get disableAutoResolve(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get<boolean>("disableAutoResolve", false),
                    "swift.disableAutoResolve"
                );
            },
            /** search sub-folder of workspace folder for Swift Packages */
            get searchSubfoldersForPackages(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get<boolean>("searchSubfoldersForPackages", false),
                    "swift.searchSubfoldersForPackages"
                );
            },
            /** Folders to ignore when searching for Swift Packages */
            get ignoreSearchingForPackagesInSubfolders(): string[] {
                return validateStringArraySettings(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get<
                            string[]
                        >("ignoreSearchingForPackagesInSubfolders", [".", ".build", "Packages", "out", "bazel-out", "bazel-bin"]),
                    "swift.ignoreSearchingForPackagesInSubfolders"
                ).map(substituteVariablesInString);
            },
            get attachmentsPath(): string {
                return validateStringSetting(
                    substituteVariablesInString(
                        vscode.workspace
                            .getConfiguration("swift", workspaceFolder)
                            .get<string>("attachmentsPath", "./.build/attachments")
                    ),
                    "swift.attachmentsPath"
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

                validateBooleanSetting(
                    !!useDebugAdapterFromToolchain,
                    "swift.debugger.useDebugAdapterFromToolchain"
                );

                // On Windows arm64 we enable swift.debugger.useDebugAdapterFromToolchain by default since CodeLLDB does
                // not support this platform and gives an awful error message.
                if (process.platform === "win32" && process.arch === "arm64") {
                    useDebugAdapterFromToolchain = useDebugAdapterFromToolchain ?? true;
                }
                const selectedAdapter = validateStringSetting<DebugAdapters>(
                    vscode.workspace
                        .getConfiguration("swift.debugger")
                        .get<DebugAdapters>("debugAdapter", "auto"),
                    "swift.debugger.debugAdapter"
                );
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
                return validateStringSetting(
                    substituteVariablesInString(
                        vscode.workspace.getConfiguration("swift.debugger").get<string>("path", "")
                    ),
                    "swift.debugger.path"
                );
            },
            get disable(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift.debugger")
                        .get<boolean>("disable", false),
                    "swift.debugger.disable"
                );
            },
            get setupCodeLLDB(): SetupCodeLLDBOptions {
                return validateStringSetting(
                    vscode.workspace
                        .getConfiguration("swift.debugger")
                        .get<SetupCodeLLDBOptions>("setupCodeLLDB", "prompt"),
                    "swift.debugger.setupCodeLLDB"
                );
            },
        };
    },
    /** Files and directories to exclude from the code coverage. */
    get excludeFromCodeCoverage(): string[] {
        return validateStringArraySettings(
            vscode.workspace.getConfiguration("swift").get<string[]>("excludeFromCodeCoverage", []),
            "swift.excludeFromCodeCoverage"
        ).map(substituteVariablesInString);
    },
    /** Whether to show inline code lenses for running and debugging tests. */
    get showTestCodeLenses(): boolean | ValidCodeLens[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean | ValidCodeLens[]>("showTestCodeLenses", true);
    },
    /** Whether to record the duration of tests in the Test Explorer. */
    get recordTestDuration(): boolean {
        return validateBooleanSetting(
            vscode.workspace.getConfiguration("swift").get<boolean>("recordTestDuration", true),
            "swift.recordTestDuration"
        );
    },
    /** Files and directories to exclude from the Package Dependencies view. */
    get excludePathsFromPackageDependencies(): string[] {
        return validateStringArraySettings(
            vscode.workspace
                .getConfiguration("swift")
                .get<string[]>("excludePathsFromPackageDependencies", []),
            "swift.excludePathsFromPackageDependencies"
        );
    },
    /** Path to folder that include swift executable */
    get path(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get<string>("path", ""),
                "swift.path"
            )
        );
    },
    /** Path to folder that include swift runtime */
    get runtimePath(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get<string>("runtimePath", ""),
                "swift.runtimePath"
            )
        );
    },
    /** Path to custom --sdk */
    get sdk(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get<string>("SDK", ""),
                "swift.SDK"
            )
        );
    },
    set sdk(value: string | undefined) {
        void vscode.workspace
            .getConfiguration("swift")
            .update("SDK", value)
            .then(() => {
                /* Put in worker queue */
            });
    },
    /** Path to custom --swift-sdk */
    get swiftSDK(): string {
        return validateStringSetting(
            vscode.workspace.getConfiguration("swift").get<string>("swiftSDK", ""),
            "swift.swiftSDK"
        );
    },
    set swiftSDK(value: string | undefined) {
        void vscode.workspace
            .getConfiguration("swift")
            .update("swiftSDK", value)
            .then(() => {
                /* Put in worker queue */
            });
    },
    /** swift build arguments */
    get buildArguments(): string[] {
        return validateStringArraySettings(
            vscode.workspace.getConfiguration("swift").get<string[]>("buildArguments", []),
            "swift.buildArguments"
        ).map(substituteVariablesInString);
    },
    scriptSwiftLanguageVersion(toolchain: SwiftToolchain): string {
        const version = validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<string>("scriptSwiftLanguageVersion", toolchain.swiftVersion.major.toString()),
            "swift.scriptSwiftLanguageVersion"
        );
        if (version.length === 0) {
            return toolchain.swiftVersion.major.toString();
        }
        return version;
    },
    /** swift package arguments */
    get packageArguments(): string[] {
        return validateStringArraySettings(
            vscode.workspace.getConfiguration("swift").get<string[]>("packageArguments", []),
            "swift.packageArguments"
        ).map(substituteVariablesInString);
    },
    /** thread/address sanitizer */
    get sanitizer(): string {
        return validateStringSetting(
            vscode.workspace.getConfiguration("swift").get<string>("sanitizer", "off"),
            "swift.sanitizer"
        );
    },
    get buildPath(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get<string>("buildPath", ""),
                "swift.buildPath"
            )
        );
    },
    get disableSwiftPMIntegration(): boolean {
        return validateBooleanSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<boolean>("disableSwiftPackageManagerIntegration", false),
            "swift.disableSwiftPackageManagerIntegration"
        );
    },
    /** Environment variables to set when building */
    get swiftEnvironmentVariables(): { [key: string]: string } {
        return validateObjectSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<{ [key: string]: string }>("swiftEnvironmentVariables", {}),
            "swift.swiftEnvironmentVariables"
        );
    },
    /** include build errors in problems view */
    get diagnosticsCollection(): DiagnosticCollectionOptions {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<DiagnosticCollectionOptions>("diagnosticsCollection", "keepSourceKit"),
            "swift.diagnosticsCollection"
        );
    },
    /** set the -diagnostic-style option when running `swift` tasks */
    get diagnosticsStyle(): DiagnosticStyle {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<DiagnosticStyle>("diagnosticsStyle", "default"),
            "swift.diagnosticsStyle"
        );
    },
    /** where to show the build progress for the running task */
    get showBuildStatus(): ShowBuildStatusOptions {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<string>("showBuildStatus", "swiftStatus"),
            "swift.showBuildStatus"
        );
    },
    /** create build tasks for the library products of the package(s) */
    get createTasksForLibraryProducts(): boolean {
        return validateBooleanSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<boolean>("createTasksForLibraryProducts", false),
            "swift.createTasksForLibraryProducts"
        );
    },
    /** background compilation */
    get backgroundCompilation(): BackgroundCompilationConfiguration {
        const value = vscode.workspace
            .getConfiguration("swift")
            .get<BackgroundCompilationConfiguration | boolean>("backgroundCompilation", false);
        return {
            get enabled(): boolean {
                return typeof value === "boolean" ? value : value.enabled;
            },
            get useDefaultTask(): boolean {
                return typeof value === "boolean" ? true : (value.useDefaultTask ?? true);
            },
            get release(): boolean {
                return typeof value === "boolean" ? false : (value.release ?? false);
            },
        };
    },
    /** background indexing */
    get backgroundIndexing(): "on" | "off" | "auto" {
        const value = validateStringSetting<"on" | "off" | "auto">(
            vscode.workspace
                .getConfiguration("swift.sourcekit-lsp")
                .get("backgroundIndexing", "auto"),
            "swift.sourcekit-lsp.backgroundIndexing"
        );

        // Legacy versions of this setting were a boolean, convert to the new string version.
        if (typeof value === "boolean") {
            return value ? "on" : "off";
        } else {
            return value;
        }
    },
    /** focus on problems view whenever there is a build error */
    get actionAfterBuildError(): ActionAfterBuildError {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<ActionAfterBuildError>("actionAfterBuildError", "Focus Terminal"),
            "swift.actionAfterBuildError"
        );
    },
    /** output additional diagnostics */
    get diagnostics(): boolean {
        return validateBooleanSetting(
            vscode.workspace.getConfiguration("swift").get<boolean>("diagnostics", false),
            "swift.diagnostics"
        );
    },
    /**
     *  Test coverage settings
     */
    /** Should test coverage report be displayed after running test coverage */
    get displayCoverageReportAfterRun(): boolean {
        return validateBooleanSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<boolean>("coverage.displayReportAfterRun", true),
            "swift.coverage.displayReportAfterRun"
        );
    },
    get alwaysShowCoverageStatusItem(): boolean {
        return validateBooleanSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<boolean>("coverage.alwaysShowStatusItem", true),
            "swift.coverage.alwaysShowStatusItem"
        );
    },
    get coverageHitColorLightMode(): string {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<string>("coverage.colors.lightMode.hit", "#c0ffc0"),
            "swift.coverage.colors.lightMode.hit"
        );
    },
    get coverageMissColorLightMode(): string {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<string>("coverage.colors.lightMode.miss", "#ffc0c0"),
            "swift.coverage.colors.lightMode.miss"
        );
    },
    get coverageHitColorDarkMode(): string {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<string>("coverage.colors.darkMode.hit", "#003000"),
            "swift.coverage.colors.darkMode.hit"
        );
    },
    get coverageMissColorDarkMode(): string {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<string>("coverage.colors.darkMode.miss", "#400000"),
            "swift.coverage.colors.darkMode.miss"
        );
    },
    get openAfterCreateNewProject(): OpenAfterCreateNewProjectOptions {
        return validateStringSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<OpenAfterCreateNewProjectOptions>("openAfterCreateNewProject", "prompt"),
            "swift.openAfterCreateNewProject"
        );
    },
    /** Whether or not the extension should warn about being unable to create symlinks on Windows */
    get warnAboutSymlinkCreation(): boolean {
        return validateBooleanSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<boolean>("warnAboutSymlinkCreation", true),
            "swift.warnAboutSymlinkCreation"
        );
    },
    set warnAboutSymlinkCreation(value: boolean) {
        void vscode.workspace
            .getConfiguration("swift")
            .update("warnAboutSymlinkCreation", value, vscode.ConfigurationTarget.Global)
            .then(() => {
                /* Put in worker queue */
            });
    },
    /** Whether or not the extension will contribute Swift environment variables to the integrated terminal */
    get enableTerminalEnvironment(): boolean {
        return validateBooleanSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<boolean>("enableTerminalEnvironment", true),
            "swift.enableTerminalEnvironment"
        );
    },
    /** Whether or not to disable SwiftPM sandboxing */
    get disableSandbox(): boolean {
        return validateBooleanSetting(
            vscode.workspace.getConfiguration("swift").get<boolean>("disableSandbox", false),
            "swift.disableSandbox"
        );
    },
    /** Workspace folder glob patterns to exclude */
    get excludePathsFromActivation(): Record<string, boolean> {
        return vscode.workspace
            .getConfiguration("swift")
            .get<Record<string, boolean>>("excludePathsFromActivation", {});
    },
    get lspConfigurationBranch(): string {
        return validateStringSetting(
            vscode.workspace.getConfiguration("swift").get<string>("lspConfigurationBranch", ""),
            "swift.lspConfigurationBranch"
        );
    },
    get checkLspConfigurationSchema(): boolean {
        return validateBooleanSetting(
            vscode.workspace
                .getConfiguration("swift")
                .get<boolean>("checkLspConfigurationSchema", true),
            "swift.checkLspConfigurationSchema"
        );
    },
    set checkLspConfigurationSchema(value: boolean) {
        void vscode.workspace
            .getConfiguration("swift")
            .update("checkLspConfigurationSchema", value)
            .then(() => {
                /* Put in worker queue */
            });
    },
    get outputChannelLogLevel(): string {
        return validateStringSetting(
            vscode.workspace.getConfiguration("swift").get("outputChannelLogLevel", "info"),
            "swift.outputChannelLogLevel"
        );
    },
    parameterHintsEnabled(documentUri: vscode.Uri): boolean {
        const enabled = validateBooleanSetting(
            vscode.workspace
                .getConfiguration("editor.parameterHints", {
                    uri: documentUri,
                    languageId: "swift",
                })
                .get<boolean>("enabled", false),
            "editor.parameterHints.enabled"
        );

        return enabled === true;
    },
};

const vsCodeVariableRegex = new RegExp(/\$\{(.+?)\}/g);
export function substituteVariablesInString(val: string): string {
    // Fallback to "" incase someone explicitly sets to null
    return (val || "").replace(vsCodeVariableRegex, (substring: string, varName: string) =>
        typeof varName === "string" ? computeVscodeVar(varName) || substring : substring
    );
}

function validateBooleanSetting(val: boolean, settingName: string): boolean {
    if (typeof val !== "boolean") {
        throw new ConfigurationValidationError(
            settingName,
            `The setting \`${settingName}\` must be a boolean`
        );
    }
    return val;
}

function validateStringSetting<T extends string = string>(val: string, settingName: string): T {
    if (typeof val !== "string") {
        throw new ConfigurationValidationError(
            settingName,
            `The setting \`${settingName}\` must be a string`
        );
    }
    return val as T;
}

function validateStringArraySettings(arr: string[], settingName: string): string[] {
    for (const v of arr) {
        if (typeof v !== "string") {
            throw new ConfigurationValidationError(
                settingName,
                `The setting \`${settingName}\` must be an array of strings`
            );
        }
    }
    return arr;
}

function validateObjectSetting<T extends object>(obj: T, settingName: string): T {
    if (typeof obj !== "object" || obj === null) {
        throw new ConfigurationValidationError(
            settingName,
            `The setting \`${settingName}\` must be an object`
        );
    }
    return obj;
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

    const file = () => vscode.window.activeTextEditor?.document?.uri?.fsPath || "";

    const regex = /workspaceFolder:(.*)/gm;
    const match = regex.exec(varName);
    if (match) {
        const name = match[1];
        return vscode.workspace.workspaceFolders?.find(f => f.name === name)?.uri.fsPath ?? null;
    }

    // https://code.visualstudio.com/docs/editor/variables-reference
    // Variables to be substituted should be added here.
    const supportedVariables: { [k: string]: () => string } = {
        workspaceFolder,
        fileWorkspaceFolder: workspaceFolder,
        workspaceFolderBasename: () => path.basename(workspaceFolder()),
        cwd: () => process.cwd(),
        userHome: () => os.homedir(),
        pathSeparator: () => path.sep,
        file,
        relativeFile: () => path.relative(workspaceFolder(), file()),
        relativeFileDirname: () => path.dirname(path.relative(workspaceFolder(), file())),
        fileBasename: () => path.basename(file()),
        fileExtname: () => path.extname(file()),
        fileDirname: () => path.dirname(file()),
        fileDirnameBasename: () => path.basename(path.dirname(file())),
    };

    return varName in supportedVariables ? supportedVariables[varName]() : null;
}

/**
 * Handler for configuration change events that triggers a reload of the extension
 * if the setting changed requires one.
 * @param ctx The workspace context.
 * @returns A disposable that unregisters the provider when disposed.
 */
export function handleConfigurationChangeEvent(
    ctx: WorkspaceContext
): (event: vscode.ConfigurationChangeEvent) => void {
    return (event: vscode.ConfigurationChangeEvent) => {
        // on toolchain config change, reload window
        if (
            event.affectsConfiguration("swift.path") &&
            configuration.path !== ctx.currentFolder?.toolchain.swiftFolderPath
        ) {
            void showReloadExtensionNotification(
                "Changing the Swift path requires Visual Studio Code be reloaded."
            );
        } else if (
            // on sdk config change, restart sourcekit-lsp
            event.affectsConfiguration("swift.SDK") ||
            event.affectsConfiguration("swift.swiftSDK")
        ) {
            void vscode.commands.executeCommand("swift.restartLSPServer").then(() => {
                /* Put in worker queue */
            });
        } else if (event.affectsConfiguration("swift.swiftEnvironmentVariables")) {
            void showReloadExtensionNotification(
                "Changing environment variables requires the project be reloaded."
            );
        }
    };
}

/**
 * Opens the appropriate settings JSON file based on where the setting is configured
 */
export async function openSettingsJsonForSetting(settingName: string): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration();
        const inspection = config.inspect(settingName);

        if (!inspection) {
            // If we can't inspect the setting, fall back to global settings
            await vscode.commands.executeCommand("workbench.action.openSettingsJson");
            return;
        }

        // Determine the most specific scope where the setting is defined
        if (inspection.workspaceFolderValue !== undefined) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const settingsUri = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    ".vscode",
                    "settings.json"
                );
                try {
                    await vscode.window.showTextDocument(settingsUri);
                    return;
                } catch {
                    // If the file doesn't exist, create it or fall back
                    await vscode.commands.executeCommand(
                        "workbench.action.openWorkspaceSettingsFile"
                    );
                    return;
                }
            }
        }

        if (inspection.workspaceValue !== undefined) {
            await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
            return;
        }

        await vscode.commands.executeCommand("workbench.action.openSettingsJson");
    } catch (error) {
        await vscode.commands.executeCommand("workbench.action.openSettingsJson");
    }
}

export default configuration;
