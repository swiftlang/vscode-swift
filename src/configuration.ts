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
import { isDeepStrictEqual } from "util";
import * as vscode from "vscode";

import { SwiftToolchain } from "./toolchain/toolchain";

// Allowed values for enumeration settings. These must match the enums in package.json.
const debugAdapters = ["auto", "lldb-dap", "CodeLLDB"] as const;
export type DebugAdapters = (typeof debugAdapters)[number];
const setupCodeLLDBOptions = [
    "prompt",
    "alwaysUpdateGlobal",
    "alwaysUpdateWorkspace",
    "never",
] as const;
export type SetupCodeLLDBOptions = (typeof setupCodeLLDBOptions)[number];
const cFamilySupportOptions = ["enable", "disable", "cpptools-inactive"] as const;
export type CFamilySupportOptions = (typeof cFamilySupportOptions)[number];
const includeDeclarationOptions = ["default", "always", "never"] as const;
export type IncludeDeclarationOptions = (typeof includeDeclarationOptions)[number];
const backgroundIndexingOptions = ["on", "off", "auto"] as const;
export type BackgroundIndexingOptions = (typeof backgroundIndexingOptions)[number];
const sanitizerOptions = ["off", "thread", "address"] as const;
export type SanitizerOptions = (typeof sanitizerOptions)[number];
const logLevels = ["trace", "debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];
const actionAfterBuildErrorOptions = ["Focus Problems", "Focus Terminal", "Do Nothing"] as const;
export type ActionAfterBuildError = (typeof actionAfterBuildErrorOptions)[number];
const openAfterCreateNewProjectOptions = [
    "always",
    "alwaysNewWindow",
    "whenNoFolderOpen",
    "prompt",
] as const;
export type OpenAfterCreateNewProjectOptions = (typeof openAfterCreateNewProjectOptions)[number];
const showBuildStatusOptions = ["never", "swiftStatus", "progress", "notification"] as const;
export type ShowBuildStatusOptions = (typeof showBuildStatusOptions)[number];
const diagnosticCollectionOptions = [
    "onlySwiftc",
    "onlySourceKit",
    "keepSwiftc",
    "keepSourceKit",
    "keepAll",
] as const;
export type DiagnosticCollectionOptions = (typeof diagnosticCollectionOptions)[number];
const diagnosticStyles = ["default", "llvm", "swift"] as const;
export type DiagnosticStyle = (typeof diagnosticStyles)[number];
export type ValidCodeLens = "run" | "debug" | "coverage";

/** sourcekit-lsp configuration */
interface LSPConfiguration {
    /** Path to sourcekit-lsp executable */
    readonly serverPath: string;
    /** Arguments to pass to sourcekit-lsp executable */
    readonly serverArguments: string[];
    /** Support C Family source files */
    readonly supportCFamily: CFamilySupportOptions;
    /** Support Languages */
    readonly supportedLanguages: string[];
    /** Is SourceKit-LSP disabled */
    readonly disable: boolean;
    /** Include declaration in Find All References results */
    readonly includeDeclarationInFindAllReferences: IncludeDeclarationOptions;
}

/** debugger configuration */
interface DebuggerConfiguration {
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
    /** Whether to ignore .swift-version files and disable automatic toolchain switching */
    readonly ignoreSwiftVersionFile: boolean;
    /** Number of directories watched for a .swift-version file, including the folder itself */
    readonly maxSwiftVersionFileWatchDepth: number;
    /** Whether or not the user should be prompted to install swiftly */
    readonly disableSwiftlyInstallPrompt: boolean;
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

interface BackgroundCompilationConfiguration {
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
                        vscode.workspace.getConfiguration("swift.sourcekit-lsp").get("serverPath"),
                        "swift.sourcekit-lsp.serverPath",
                        ""
                    )
                );
            },
            get serverArguments(): string[] {
                return validateStringArraySettings(
                    vscode.workspace.getConfiguration("swift.sourcekit-lsp").get("serverArguments"),
                    "swift.sourcekit-lsp.serverArguments",
                    []
                ).map(substituteVariablesInString);
            },
            get supportCFamily(): CFamilySupportOptions {
                return validateEnumSetting(
                    vscode.workspace.getConfiguration("sourcekit-lsp").get("support-c-cpp"),
                    "sourcekit-lsp.support-c-cpp",
                    "cpptools-inactive",
                    cFamilySupportOptions
                );
            },
            get supportedLanguages() {
                return validateStringArraySettings(
                    vscode.workspace
                        .getConfiguration("swift.sourcekit-lsp")
                        .get("supported-languages"),
                    "swift.sourcekit-lsp.supported-languages",
                    ["swift", "objective-c", "objective-cpp", "c", "cpp"]
                );
            },
            get disable(): boolean {
                return validateBooleanSetting(
                    vscode.workspace.getConfiguration("swift.sourcekit-lsp").get("disable"),
                    "swift.sourcekit-lsp.disable",
                    false
                );
            },
            get includeDeclarationInFindAllReferences(): IncludeDeclarationOptions {
                return validateEnumSetting(
                    vscode.workspace
                        .getConfiguration("swift.sourcekit-lsp")
                        .get("includeDeclarationInFindAllReferences"),
                    "swift.sourcekit-lsp.includeDeclarationInFindAllReferences",
                    "default",
                    includeDeclarationOptions
                );
            },
        };
    },

    folder(workspaceFolder: vscode.WorkspaceFolder | undefined): FolderConfiguration {
        /**
         * Look up a plugin setting that is either a single value that applies to all plugins
         * or an object of values keyed by plugin ID. Invalid values are treated as if they
         * were never set.
         */
        function pluginSetting<T extends object>(
            setting: string,
            pluginId: string | undefined,
            isValid: (val: unknown) => val is T,
            expectedType: string
        ): T | undefined {
            const settingName = `swift.${setting}`;
            const value = validateSetting(
                vscode.workspace.getConfiguration("swift", workspaceFolder).get(setting),
                settingName,
                undefined,
                (v): v is T | Record<string, unknown> => isValid(v) || isRecord(v),
                expectedType
            );
            if (value === undefined) {
                return undefined;
            }

            if (pluginId) {
                if (!isRecord(value)) {
                    return undefined;
                }
                return validateSetting(
                    value[pluginId],
                    settingName,
                    undefined,
                    isValid,
                    expectedType
                );
            }

            // Check for * as a wildcard plugin ID for configurations that want both
            // global arguments as well as specific additional arguments for a plugin.
            const wildcardSetting = pluginSetting(setting, "*", isValid, expectedType);
            if (wildcardSetting) {
                return wildcardSetting;
            }

            // Check if there is a global setting like `"swift.pluginArguments": ["-c", "release"]`
            // that should apply to all plugins.
            if (isValid(value) && Object.keys(value).length !== 0) {
                return value;
            }
            return undefined;
        }
        return {
            /** Environment variables to set when running tests */
            get testEnvironmentVariables(): { [key: string]: string } {
                return validateStringRecordSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get("testEnvironmentVariables"),
                    "swift.testEnvironmentVariables",
                    {}
                );
            },
            /** Extra arguments to pass to swift test and swift build when running and debugging tests. */
            get additionalTestArguments(): string[] {
                return validateStringArraySettings(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get("additionalTestArguments"),
                    "swift.additionalTestArguments",
                    []
                ).map(substituteVariablesInString);
            },
            /** auto-generate launch.json configurations */
            get autoGenerateLaunchConfigurations(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get("autoGenerateLaunchConfigurations"),
                    "swift.autoGenerateLaunchConfigurations",
                    true
                );
            },
            /** disable automatic running of swift package resolve */
            get disableAutoResolve(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get("disableAutoResolve"),
                    "swift.disableAutoResolve",
                    false
                );
            },
            /** search sub-folder of workspace folder for Swift Packages */
            get searchSubfoldersForPackages(): boolean {
                return validateBooleanSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get("searchSubfoldersForPackages"),
                    "swift.searchSubfoldersForPackages",
                    false
                );
            },
            /** Folders to ignore when searching for Swift Packages */
            get ignoreSearchingForPackagesInSubfolders(): string[] {
                return validateStringArraySettings(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get("ignoreSearchingForPackagesInSubfolders"),
                    "swift.ignoreSearchingForPackagesInSubfolders",
                    [".", ".build", "Packages", "out", "bazel-out", "bazel-bin"]
                ).map(substituteVariablesInString);
            },
            get attachmentsPath(): string {
                return substituteVariablesInString(
                    validateStringSetting(
                        vscode.workspace
                            .getConfiguration("swift", workspaceFolder)
                            .get("attachmentsPath"),
                        "swift.attachmentsPath",
                        ".build/attachments"
                    )
                );
            },
            get disableSwiftlyInstallPrompt(): boolean {
                return validateBooleanSetting(
                    vscode.workspace.getConfiguration("swift").get("disableSwiftlyInstallPrompt"),
                    "swift.disableSwiftlyInstallPrompt",
                    false
                );
            },
            get ignoreSwiftVersionFile(): boolean {
                return validateBooleanSetting(
                    vscode.workspace.getConfiguration("swift").get("ignoreSwiftVersionFile"),
                    "swift.ignoreSwiftVersionFile",
                    false
                );
            },
            get maxSwiftVersionFileWatchDepth(): number {
                return validateIntegerSetting(
                    vscode.workspace
                        .getConfiguration("swift", workspaceFolder)
                        .get("maxSwiftVersionFileWatchDepth"),
                    "swift.maxSwiftVersionFileWatchDepth",
                    64,
                    1
                );
            },
            pluginPermissions(pluginId?: string): PluginPermissionConfiguration {
                return (
                    pluginSetting(
                        "pluginPermissions",
                        pluginId,
                        (v): v is PluginPermissionConfiguration => isRecord(v),
                        "an object"
                    ) ?? {}
                );
            },
            pluginArguments(pluginId?: string): string[] {
                return (
                    pluginSetting(
                        "pluginArguments",
                        pluginId,
                        isStringArray,
                        "an array of strings, or an object whose values are arrays of strings"
                    ) ?? []
                );
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
                // Treat an invalid value as if the setting was never set.
                let useDebugAdapterFromToolchain = validateSetting(
                    inspectUseDebugAdapterFromToolchain?.workspaceValue ??
                        inspectUseDebugAdapterFromToolchain?.globalValue,
                    "swift.debugger.useDebugAdapterFromToolchain",
                    undefined,
                    isBoolean,
                    "a boolean"
                );

                // On Windows arm64 we enable swift.debugger.useDebugAdapterFromToolchain by default since CodeLLDB does
                // not support this platform and gives an awful error message.
                if (process.platform === "win32" && process.arch === "arm64") {
                    useDebugAdapterFromToolchain = useDebugAdapterFromToolchain ?? true;
                }
                const selectedAdapter = validateEnumSetting(
                    vscode.workspace.getConfiguration("swift.debugger").get("debugAdapter"),
                    "swift.debugger.debugAdapter",
                    "auto",
                    debugAdapters
                );
                if (selectedAdapter === "auto") {
                    if (useDebugAdapterFromToolchain !== undefined) {
                        return useDebugAdapterFromToolchain ? "lldb-dap" : "CodeLLDB";
                    }
                    return "auto";
                }
                return selectedAdapter;
            },
            get customDebugAdapterPath(): string {
                return substituteVariablesInString(
                    validateStringSetting(
                        vscode.workspace.getConfiguration("swift.debugger").get("path"),
                        "swift.debugger.path",
                        ""
                    )
                );
            },
            get disable(): boolean {
                return validateBooleanSetting(
                    vscode.workspace.getConfiguration("swift.debugger").get("disable"),
                    "swift.debugger.disable",
                    false
                );
            },
            get setupCodeLLDB(): SetupCodeLLDBOptions {
                return validateEnumSetting(
                    vscode.workspace.getConfiguration("swift.debugger").get("setupCodeLLDB"),
                    "swift.debugger.setupCodeLLDB",
                    "prompt",
                    setupCodeLLDBOptions
                );
            },
        };
    },
    /** Files and directories to exclude from the code coverage. */
    get excludeFromCodeCoverage(): string[] {
        return validateStringArraySettings(
            vscode.workspace.getConfiguration("swift").get("excludeFromCodeCoverage"),
            "swift.excludeFromCodeCoverage",
            []
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
            vscode.workspace.getConfiguration("swift").get("recordTestDuration"),
            "swift.recordTestDuration",
            true
        );
    },
    /** Files and directories to exclude from the Package Dependencies view. */
    get excludePathsFromPackageDependencies(): string[] {
        return validateStringArraySettings(
            vscode.workspace.getConfiguration("swift").get("excludePathsFromPackageDependencies"),
            "swift.excludePathsFromPackageDependencies",
            ["**/.git", "**/.github"]
        );
    },
    /** Path to folder that include swift executable */
    get path(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get("path"),
                "swift.path",
                ""
            )
        );
    },
    /** Path to folder that include swift runtime */
    get runtimePath(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get("runtimePath"),
                "swift.runtimePath",
                ""
            )
        );
    },
    /** Path to custom --sdk */
    get sdk(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get("SDK"),
                "swift.SDK",
                ""
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
            vscode.workspace.getConfiguration("swift").get("swiftSDK"),
            "swift.swiftSDK",
            ""
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
            vscode.workspace.getConfiguration("swift").get("buildArguments"),
            "swift.buildArguments",
            []
        ).map(substituteVariablesInString);
    },
    scriptSwiftLanguageVersion(toolchain: SwiftToolchain): string {
        const version = validateStringSetting(
            vscode.workspace.getConfiguration("swift").get("scriptSwiftLanguageVersion"),
            "swift.scriptSwiftLanguageVersion",
            toolchain.swiftVersion.major.toString()
        );
        if (version.length === 0) {
            return toolchain.swiftVersion.major.toString();
        }
        return version;
    },
    /** swift package arguments */
    get packageArguments(): string[] {
        return validateStringArraySettings(
            vscode.workspace.getConfiguration("swift").get("packageArguments"),
            "swift.packageArguments",
            []
        ).map(substituteVariablesInString);
    },
    /** thread/address sanitizer */
    get sanitizer(): SanitizerOptions {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("sanitizer"),
            "swift.sanitizer",
            "off",
            sanitizerOptions
        );
    },
    get buildPath(): string {
        return substituteVariablesInString(
            validateStringSetting(
                vscode.workspace.getConfiguration("swift").get("buildPath"),
                "swift.buildPath",
                ""
            )
        );
    },
    get disableSwiftPMIntegration(): boolean {
        return validateBooleanSetting(
            vscode.workspace.getConfiguration("swift").get("disableSwiftPackageManagerIntegration"),
            "swift.disableSwiftPackageManagerIntegration",
            false
        );
    },
    /** Environment variables to set when building */
    get swiftEnvironmentVariables(): { [key: string]: string } {
        return validateStringRecordSetting(
            vscode.workspace.getConfiguration("swift").get("swiftEnvironmentVariables"),
            "swift.swiftEnvironmentVariables",
            {}
        );
    },
    /** include build errors in problems view */
    get diagnosticsCollection(): DiagnosticCollectionOptions {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("diagnosticsCollection"),
            "swift.diagnosticsCollection",
            "keepSourceKit",
            diagnosticCollectionOptions
        );
    },
    /** set the -diagnostic-style option when running `swift` tasks */
    get diagnosticsStyle(): DiagnosticStyle {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("diagnosticsStyle"),
            "swift.diagnosticsStyle",
            "default",
            diagnosticStyles
        );
    },
    /** where to show the build progress for the running task */
    get showBuildStatus(): ShowBuildStatusOptions {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("showBuildStatus"),
            "swift.showBuildStatus",
            "swiftStatus",
            showBuildStatusOptions
        );
    },
    /** create build tasks for the library products of the package(s) */
    get createTasksForLibraryProducts(): boolean {
        return validateBooleanSetting(
            vscode.workspace.getConfiguration("swift").get("createTasksForLibraryProducts"),
            "swift.createTasksForLibraryProducts",
            false
        );
    },
    /** background compilation */
    get backgroundCompilation(): BackgroundCompilationConfiguration {
        const value = validateSetting(
            vscode.workspace.getConfiguration("swift").get("backgroundCompilation"),
            "swift.backgroundCompilation",
            false,
            (v): v is boolean | Partial<BackgroundCompilationConfiguration> =>
                isBoolean(v) ||
                (isRecord(v) &&
                    (["enabled", "useDefaultTask", "release"] as const).every(
                        key => v[key] === undefined || isBoolean(v[key])
                    )),
            "a boolean or an object with boolean properties"
        );
        return {
            get enabled(): boolean {
                return typeof value === "boolean" ? value : (value.enabled ?? false);
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
    get backgroundIndexing(): BackgroundIndexingOptions {
        const value = vscode.workspace
            .getConfiguration("swift.sourcekit-lsp")
            .get("backgroundIndexing", "auto");

        // Legacy versions of this setting were a boolean, convert to the new string version.
        if (typeof value === "boolean") {
            return value ? "on" : "off";
        } else {
            return validateEnumSetting(
                value,
                "swift.sourcekit-lsp.backgroundIndexing",
                "auto",
                backgroundIndexingOptions
            );
        }
    },
    /** focus on problems view whenever there is a build error */
    get actionAfterBuildError(): ActionAfterBuildError {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("actionAfterBuildError"),
            "swift.actionAfterBuildError",
            "Focus Terminal",
            actionAfterBuildErrorOptions
        );
    },
    get openAfterCreateNewProject(): OpenAfterCreateNewProjectOptions {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("openAfterCreateNewProject"),
            "swift.openAfterCreateNewProject",
            "prompt",
            openAfterCreateNewProjectOptions
        );
    },
    /** Whether or not the extension should warn about being unable to create symlinks on Windows */
    get warnAboutSymlinkCreation(): boolean {
        return validateBooleanSetting(
            vscode.workspace.getConfiguration("swift").get("warnAboutSymlinkCreation"),
            "swift.warnAboutSymlinkCreation",
            true
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
            vscode.workspace.getConfiguration("swift").get("enableTerminalEnvironment"),
            "swift.enableTerminalEnvironment",
            true
        );
    },
    /** Whether or not to disable SwiftPM sandboxing */
    get disableSandbox(): boolean {
        const config = vscode.workspace.getConfiguration("swift");
        const sandbox = getExplicitSetting<boolean>(config, "disableSandbox");
        if (sandbox !== undefined) {
            return validateBooleanSetting(sandbox, "swift.disableSandbox", false);
        }
        const sandboxTypo = getExplicitSetting<boolean>(config, "disableSandox");
        if (sandboxTypo !== undefined) {
            return validateBooleanSetting(sandboxTypo, "swift.disableSandox", false);
        }
        return false;
    },
    /** Workspace folder glob patterns to exclude */
    get excludePathsFromActivation(): Record<string, boolean> {
        return vscode.workspace
            .getConfiguration("swift")
            .get<Record<string, boolean>>("excludePathsFromActivation", {});
    },
    get lspConfigurationBranch(): string {
        const branch = getExplicitSetting<string>(
            vscode.workspace.getConfiguration("swift.sourcekit-lsp"),
            "configurationBranch"
        );
        if (branch !== undefined) {
            return validateStringSetting(branch, "swift.sourcekit-lsp.configurationBranch", "");
        }
        const deprecatedBranch = getExplicitSetting<string>(
            vscode.workspace.getConfiguration("swift"),
            "lspConfigurationBranch"
        );
        if (deprecatedBranch !== undefined) {
            return validateStringSetting(deprecatedBranch, "swift.lspConfigurationBranch", "");
        }
        return "";
    },
    get checkLspConfigurationSchema(): boolean {
        const check = getExplicitSetting<boolean>(
            vscode.workspace.getConfiguration("swift.sourcekit-lsp"),
            "checkConfigurationSchema"
        );
        if (check !== undefined) {
            return validateBooleanSetting(
                check,
                "swift.sourcekit-lsp.checkConfigurationSchema",
                true
            );
        }
        const deprecatedCheck = getExplicitSetting<boolean>(
            vscode.workspace.getConfiguration("swift"),
            "checkLspConfigurationSchema"
        );
        if (deprecatedCheck !== undefined) {
            return validateBooleanSetting(
                deprecatedCheck,
                "swift.checkLspConfigurationSchema",
                true
            );
        }
        return true;
    },
    set checkLspConfigurationSchema(value: boolean) {
        void vscode.workspace
            .getConfiguration("swift.sourcekit-lsp")
            .update("checkConfigurationSchema", value)
            .then(() => {
                /* Put in worker queue */
            });
    },
    get outputChannelLogLevel(): LogLevel {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("outputChannelLogLevel"),
            "swift.outputChannelLogLevel",
            "info",
            logLevels
        );
    },
    get logFileLogLevel(): LogLevel {
        return validateEnumSetting(
            vscode.workspace.getConfiguration("swift").get("logFileLogLevel"),
            "swift.logFileLogLevel",
            "debug",
            logLevels
        );
    },
    parameterHintsEnabled(documentUri: vscode.Uri): boolean {
        const enabled = validateBooleanSetting(
            vscode.workspace
                .getConfiguration("editor.parameterHints", {
                    uri: documentUri,
                    languageId: "swift",
                })
                .get("enabled"),
            "editor.parameterHints.enabled",
            false
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

/**
 * Validates a setting value, falling back to the default value if it is invalid.
 *
 * An undefined value means that the setting is not configured and silently uses the default.
 * Any other invalid value shows a warning to the user that points them to the setting.
 */
function validateSetting<T, D = T>(
    val: unknown,
    settingName: string,
    defaultValue: D,
    isValid: (val: unknown) => val is T,
    expectedType: string
): T | D {
    if (val === undefined) {
        return defaultValue;
    }
    if (!isValid(val)) {
        showInvalidSettingWarning(
            settingName,
            val,
            `The setting \`${settingName}\` must be ${expectedType}. Using the default value instead.`
        );
        return defaultValue;
    }
    return val;
}

function isBoolean(val: unknown): val is boolean {
    return typeof val === "boolean";
}

function validateBooleanSetting(val: unknown, settingName: string, defaultValue: boolean): boolean {
    return validateSetting(val, settingName, defaultValue, isBoolean, "a boolean");
}

function validateIntegerSetting(
    val: unknown,
    settingName: string,
    defaultValue: number,
    minimum: number
): number {
    const num = validateSetting(
        val,
        settingName,
        defaultValue,
        (v): v is number => typeof v === "number" && !Number.isNaN(v),
        "an integer"
    );
    if (num < minimum) {
        // An out of range value is still usable, so clamp it instead of using the default.
        showInvalidSettingWarning(
            settingName,
            num,
            `The setting \`${settingName}\` must be greater than or equal to ${minimum}`
        );
        return minimum;
    }
    return Math.floor(num);
}

function validateStringSetting<T extends string = string>(
    val: unknown,
    settingName: string,
    defaultValue: T
): T {
    return validateSetting(
        val,
        settingName,
        defaultValue,
        (v): v is T => typeof v === "string",
        "a string"
    );
}

function validateEnumSetting<T>(
    val: unknown,
    settingName: string,
    defaultValue: NoInfer<T>,
    allowedValues: readonly T[]
): T {
    return validateSetting(
        val,
        settingName,
        defaultValue,
        (v): v is T => typeof v === "string" && (allowedValues as readonly string[]).includes(v),
        "one of " + allowedValues.map(v => "`" + v + "`").join(", ")
    );
}

function isStringArray(val: unknown): val is string[] {
    return Array.isArray(val) && val.every(e => typeof e === "string");
}

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === "object" && val !== null && !Array.isArray(val);
}

function validateStringArraySettings(
    val: unknown,
    settingName: string,
    defaultValue: string[]
): string[] {
    return validateSetting(val, settingName, defaultValue, isStringArray, "an array of strings");
}

function validateStringRecordSetting(
    val: unknown,
    settingName: string,
    defaultValue: { [key: string]: string }
): { [key: string]: string } {
    const record = validateSetting(
        val,
        settingName,
        defaultValue,
        isRecord,
        "an object whose values are strings"
    );
    const entries = Object.entries(record);
    const validEntries = entries.filter((e): e is [string, string] => typeof e[1] === "string");
    if (validEntries.length !== entries.length) {
        // The valid entries are still usable, so drop the invalid ones instead of using the default.
        const invalidKeys = entries
            .filter(([, v]) => typeof v !== "string")
            .map(([k]) => "`" + k + "`");
        showInvalidSettingWarning(
            settingName,
            record,
            `The setting \`${settingName}\` must be an object whose values are strings. Ignoring ${invalidKeys.join(", ")}.`
        );
    }
    return Object.fromEntries(validEntries);
}

function getExplicitSetting<T>(config: vscode.WorkspaceConfiguration, key: string): T | undefined {
    const inspect = config.inspect<T>(key);
    if (
        inspect?.globalValue !== undefined ||
        inspect?.workspaceValue !== undefined ||
        inspect?.workspaceFolderValue !== undefined
    ) {
        return config.get<T>(key);
    }
    return undefined;
}

// To avoid spamming the user with multiple warnings for the same bad setting/value
// we keep track of the bad values we've already reported during this session. A setting
// can have a different value in each workspace folder, so every reported value is kept.
const reportedBadSettings = new Map<string, unknown[]>();

/**
 * Forget which bad settings have been reported so that they will be reported again.
 * Only intended for use in tests.
 */
export function resetReportedSettingWarnings(): void {
    reportedBadSettings.clear();
}

/**
 * Show a warning to the user that points them at a poorly configured setting.
 */
function showInvalidSettingWarning(
    settingName: string,
    settingValue: unknown,
    message: string
): void {
    const reportedValues = reportedBadSettings.get(settingName) ?? [];
    if (reportedValues.some(v => isDeepStrictEqual(v, settingValue))) {
        return;
    }
    reportedBadSettings.set(settingName, [...reportedValues, settingValue]);
    void vscode.window.showWarningMessage(message, "Open Settings").then(selection => {
        if (selection === "Open Settings") {
            void openSettingsJsonForSetting(settingName);
        }
    });
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
 * Opens the appropriate settings JSON file based on where the setting is configured
 */
async function openSettingsJsonForSetting(settingName: string): Promise<void> {
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
