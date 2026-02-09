//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
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

import { FolderContext } from "../FolderContext";
import { Commands } from "../commands";
import { handleMissingSwiftly } from "../commands/installSwiftly";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { Swiftly } from "../toolchain/swiftly";
import { SwiftToolchain } from "../toolchain/toolchain";
import { isEmptyObject } from "../utilities/utilities";
import { showReloadExtensionNotification } from "./ReloadExtension";

/**
 * Open the installation page on Swift.org
 */
async function downloadToolchain() {
    if (await vscode.env.openExternal(vscode.Uri.parse("https://www.swift.org/install"))) {
        const selected = await showReloadExtensionNotification(
            "The Swift extension must be reloaded once you have downloaded and installed the new toolchain.",
            "Select Toolchain"
        );
        if (selected === "Select Toolchain") {
            await selectToolchain();
        }
    }
}

/**
 * Open the installation page for Swiftly
 */
async function installSwiftly() {
    if (await vscode.env.openExternal(vscode.Uri.parse("https://www.swift.org/install/"))) {
        const selected = await showReloadExtensionNotification(
            "The Swift extension must be reloaded once you have downloaded and installed the new toolchain.",
            "Select Toolchain"
        );
        if (selected === "Select Toolchain") {
            await selectToolchain();
        }
    }
}

/**
 * Prompt the user to select a folder where they have installed the swift toolchain.
 * Updates the swift.path configuration with the selected folder.
 */
async function selectToolchainFolder() {
    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "Select the folder containing Swift binaries",
        openLabel: "Select folder",
    });
    if (!selected || selected.length !== 1) {
        return;
    }
    await setToolchainPath({
        category: "public",
        swiftFolderPath: selected[0].fsPath,
    });
}

/**
 * Displays an error notification to the user that toolchain discovery failed.
 * @returns true if the user made a selection (and potentially updated toolchain settings), false if they dismissed the dialog
 */
export async function showToolchainError(
    extensionPath: string,
    folder?: vscode.Uri
): Promise<boolean> {
    let selected: "Remove From Settings" | "Select Toolchain" | "Install Swiftly" | undefined;
    const folderName = folder ? `${FolderContext.uriName(folder)}: ` : "";
    if (configuration.path) {
        selected = await vscode.window.showErrorMessage(
            `${folderName}The Swift executable at "${configuration.path}" either could not be found or failed to launch. Please select a new toolchain.`,
            "Remove From Settings",
            "Select Toolchain"
        );
    } else {
        selected = await vscode.window.showErrorMessage(
            `${folderName}Unable to automatically discover your Swift toolchain. Install Swiftly to install the latest toolchain or provide the path to an existing toolchain.`,
            "Install Swiftly",
            "Select Toolchain"
        );
    }

    if (selected === "Remove From Settings") {
        await removeToolchainPath();
        return true;
    } else if (selected === "Select Toolchain") {
        await selectToolchain();
        return true;
    } else if (selected === "Install Swiftly") {
        await handleMissingSwiftly(["latest"], extensionPath);
        return true;
    }
    return false;
}

/**
 * Shows a dialog asking user permission to install a missing Swiftly toolchain
 * @param version The toolchain version to install
 * @param folder Optional folder context for the error
 * @returns Promise<boolean> true if user agrees to install, false otherwise
 */
export async function showMissingToolchainDialog(
    version: string,
    folder?: vscode.Uri
): Promise<boolean> {
    const folderName = folder ? `${FolderContext.uriName(folder)}: ` : "";
    const message =
        `${folderName}Swift version ${version} is required but not installed. ` +
        `Would you like to automatically install it using Swiftly?`;

    const choice = await vscode.window.showWarningMessage(message, "Install Toolchain", "Cancel");
    return choice === "Install Toolchain";
}

export async function selectToolchain() {
    await vscode.commands.executeCommand(Commands.SELECT_TOOLCHAIN);
}

/** A {@link vscode.QuickPickItem} that contains the path to an installed Swift toolchain */
type SwiftToolchainItem = PublicSwiftToolchainItem | XcodeToolchainItem | SwiftlyToolchainItem;

/** Common properties for a {@link vscode.QuickPickItem} that represents a Swift toolchain */
interface BaseSwiftToolchainItem extends vscode.QuickPickItem {
    type: "toolchain";
    onDidSelect?(target: vscode.ConfigurationTarget): Promise<void>;
}

/** A {@link vscode.QuickPickItem} for a Swift toolchain that has been installed manually */
interface PublicSwiftToolchainItem extends BaseSwiftToolchainItem {
    category: "public";
    toolchainPath: string;
    swiftFolderPath: string;
}

/** A {@link vscode.QuickPickItem} for a Swift toolchain provided by an installed Xcode application */
interface XcodeToolchainItem extends BaseSwiftToolchainItem {
    category: "xcode";
    xcodePath: string;
    toolchainPath: string;
    swiftFolderPath: string;
}

/** A {@link vscode.QuickPickItem} for a Swift toolchain provided by Swiftly */
interface SwiftlyToolchainItem extends BaseSwiftToolchainItem {
    category: "swiftly";
    version: string;
}

/** A {@link vscode.QuickPickItem} that performs an action for the user */
interface ActionItem extends vscode.QuickPickItem {
    type: "action";
    run(): Promise<void>;
}

/** A {@link vscode.QuickPickItem} that separates items in the UI */
class SeparatorItem implements vscode.QuickPickItem {
    readonly type = "separator";
    readonly kind = vscode.QuickPickItemKind.Separator;
    readonly label: string;

    constructor(label: string) {
        this.label = label;
    }
}

/** The possible types of {@link vscode.QuickPickItem} in the toolchain selection dialog */
type SelectToolchainItem = SwiftToolchainItem | ActionItem | SeparatorItem;

/**
 * Retrieves all {@link SelectToolchainItem} that are available on the system.
 *
 * @returns an array of {@link SelectToolchainItem}
 * @param activeToolchain
 * @param logger
 * @param cwd
 */
async function getQuickPickItems(
    activeToolchain: SwiftToolchain | undefined,
    logger: SwiftLogger,
    cwd?: vscode.Uri
): Promise<SelectToolchainItem[]> {
    // Find any Xcode installations on the system
    const xcodes = (await SwiftToolchain.findXcodeInstalls())
        // Sort in descending order alphabetically
        .sort((a, b) => -a.localeCompare(b))
        .map<SwiftToolchainItem>(xcodePath => {
            const toolchainPath = path.join(
                xcodePath,
                "Contents",
                "Developer",
                "Toolchains",
                "XcodeDefault.xctoolchain",
                "usr"
            );
            return {
                type: "toolchain",
                category: "xcode",
                label: path.basename(xcodePath, ".app"),
                detail: xcodePath,
                xcodePath,
                toolchainPath,
                swiftFolderPath: path.join(toolchainPath, "bin"),
            };
        });
    // Find any Swift toolchains installed via Swiftly
    const installedSwiftlyToolchains = await Swiftly.list(logger);
    const swiftlyLocations = new Set(
        installedSwiftlyToolchains
            .map(t => t.location)
            .filter((loc): loc is string => loc !== undefined)
    );
    const swiftlyToolchains = installedSwiftlyToolchains.map<SwiftlyToolchainItem>(toolchain => ({
        type: "toolchain",
        label: toolchain.name,
        category: "swiftly",
        version: toolchain.name,
        onDidSelect: async target => {
            try {
                if (target === vscode.ConfigurationTarget.Global) {
                    await Swiftly.use(toolchain.name);
                } else {
                    await Promise.all(
                        vscode.workspace.workspaceFolders?.map(async folder => {
                            await Swiftly.use(toolchain.name, folder.uri.fsPath);
                        }) ?? []
                    );
                }
                void showReloadExtensionNotification(
                    "Changing the Swift path requires Visual Studio Code be reloaded."
                );
            } catch (error) {
                logger.error(error);
                void vscode.window.showErrorMessage(`Failed to switch Swiftly toolchain: ${error}`);
            }
        },
    }));

    // Find any public Swift toolchains on the system, excluding those managed by swiftly
    const publicToolchains = (await SwiftToolchain.getToolchainInstalls())
        .filter(toolchainPath => !swiftlyLocations.has(toolchainPath))
        // Sort in descending order alphabetically
        .sort((a, b) => -a.localeCompare(b))
        .map<SwiftToolchainItem>(toolchainPath => {
            const result: SwiftToolchainItem = {
                type: "toolchain",
                category: "public",
                label: path.basename(toolchainPath, ".xctoolchain"),
                detail: toolchainPath,
                toolchainPath: path.join(toolchainPath, "usr"),
                swiftFolderPath: path.join(toolchainPath, "usr", "bin"),
            };
            if (result.label === "swift-latest") {
                result.label = "Latest Installed Toolchain";
                result.onDidSelect = async () => {
                    void vscode.window.showInformationMessage(
                        `The Swift extension is now configured to always use the most recently installed toolchain pointed at by the symbolic link "${toolchainPath}".`
                    );
                };
            }
            return result;
        });

    if (activeToolchain) {
        let currentSwiftlyVersion: string | undefined = undefined;
        if (activeToolchain.manager === "swiftly") {
            currentSwiftlyVersion = await Swiftly.inUseVersion("swiftly", cwd);
            if (currentSwiftlyVersion === undefined) {
                // swiftly <1.1.0 does not support JSON output and will report no active
                // toolchain version. Fall back to using the active toolchain version as a
                // last resort.
                currentSwiftlyVersion = activeToolchain.swiftVersion.toString();
            }
        }
        const toolchainInUse = [...xcodes, ...publicToolchains, ...swiftlyToolchains].find(
            toolchain => {
                if (currentSwiftlyVersion) {
                    if (toolchain.category !== "swiftly") {
                        return false;
                    }

                    // For Swiftly toolchains, check if the label matches the active toolchain version
                    return currentSwiftlyVersion === toolchain.label;
                }
                // For non-Swiftly toolchains, check if the toolchain path matches
                return (
                    (toolchain as PublicSwiftToolchainItem | XcodeToolchainItem).toolchainPath ===
                    activeToolchain.toolchainPath
                );
            }
        );
        if (toolchainInUse) {
            toolchainInUse.description = "$(check) in use";
        } else {
            publicToolchains.splice(0, 0, {
                type: "toolchain",
                category: "public",
                label: `Swift ${activeToolchain.swiftVersion.toString()}`,
                description: "$(check) in use",
                detail: activeToolchain.toolchainPath,
                toolchainPath: activeToolchain.toolchainPath,
                swiftFolderPath: activeToolchain.swiftFolderPath,
            });
        }
    }
    // Various actions that the user can perform (e.g. to install new toolchains)
    const actionItems: ActionItem[] = [
        ...(await getSwiftlyActions()),
        {
            type: "action",
            label: "$(cloud-download) Download from Swift.org...",
            detail: "Open https://swift.org/install to download and install a toolchain",
            run: downloadToolchain,
        },
        {
            type: "action",
            label: "$(folder-opened) Select toolchain directory...",
            detail: "Select a folder on your machine where the Swift toolchain is installed",
            run: selectToolchainFolder,
        },
    ];

    return [
        ...(swiftlyToolchains.length > 0
            ? [new SeparatorItem("swiftly"), ...swiftlyToolchains]
            : []),
        ...(xcodes.length > 0 ? [new SeparatorItem("Xcode"), ...xcodes] : []),
        ...(publicToolchains.length > 0
            ? [new SeparatorItem("toolchains"), ...publicToolchains]
            : []),
        new SeparatorItem("actions"),
        ...actionItems,
    ];
}

async function getSwiftlyActions(): Promise<ActionItem[]> {
    if (!Swiftly.isSupported()) {
        return [];
    }
    if (!(await Swiftly.isInstalled())) {
        const platformName = process.platform === "linux" ? "Linux" : "macOS";
        return [
            {
                type: "action",
                label: "$(swift-icon) Install Swiftly for toolchain management...",
                detail: `Install https://swiftlang.github.io/swiftly to manage your toolchains on ${platformName}`,
                run: installSwiftly,
            },
        ];
    }
    // We only support installing toolchains via Swiftly starting in Swiftly 1.1.0
    const swiftlyVersion = await Swiftly.version();
    if (swiftlyVersion?.isLessThan({ major: 1, minor: 1, patch: 0 })) {
        return [];
    }
    return [
        {
            type: "action",
            label: "$(cloud-download) Install Swiftly toolchain...",
            detail: "Install a Swift stable release toolchain via Swiftly",
            run: async () => {
                await vscode.commands.executeCommand(Commands.INSTALL_SWIFTLY_TOOLCHAIN);
            },
        },
        {
            type: "action",
            label: "$(beaker) Install Swiftly snapshot toolchain...",
            detail: "Install a Swift snapshot toolchain via Swiftly from development builds",
            run: async () => {
                await vscode.commands.executeCommand(Commands.INSTALL_SWIFTLY_SNAPSHOT_TOOLCHAIN);
            },
        },
    ];
}

/**
 * Prompt the user to select or install a swift toolchain. Updates the swift.path configuration
 * with the user's selection.
 *
 * @param activeToolchain the {@link WorkspaceContext}
 * @param logger
 * @param cwd
 */
export async function showToolchainSelectionQuickPick(
    activeToolchain: SwiftToolchain | undefined,
    logger: SwiftLogger,
    cwd?: vscode.Uri
) {
    let xcodePaths: string[] = [];
    const selectedToolchain = await vscode.window.showQuickPick<SelectToolchainItem>(
        getQuickPickItems(activeToolchain, logger, cwd).then(result => {
            xcodePaths = result
                .filter((i): i is XcodeToolchainItem => "category" in i && i.category === "xcode")
                .map(xcode => xcode.xcodePath);
            return result;
        }),
        {
            title: "Select the Swift toolchain",
            placeHolder: "Pick a Swift toolchain that VS Code will use",
            canPickMany: false,
        }
    );
    if (selectedToolchain?.type === "action") {
        return await selectedToolchain.run();
    }
    if (selectedToolchain?.type === "toolchain") {
        // Select an Xcode to build with
        let developerDir: string | undefined = undefined;
        if (selectedToolchain.category === "xcode") {
            developerDir = await SwiftToolchain.getXcodeDeveloperDir({
                ...process.env,
                DEVELOPER_DIR: selectedToolchain.xcodePath,
            });
        } else {
            const selectedDeveloperDir = await showDeveloperDirQuickPick(xcodePaths);
            if (!selectedDeveloperDir) {
                return;
            }
            developerDir = selectedDeveloperDir.developerDir;
        }
        // Update the toolchain configuration
        await setToolchainPath(selectedToolchain, developerDir);
        return;
    }
}

async function showXcodeQuickPick(
    xcodePaths: string[]
): Promise<{ type: "selected"; xcodePath: string | undefined } | undefined> {
    if (process.platform !== "darwin" || xcodePaths.length === 0) {
        return { type: "selected", xcodePath: undefined };
    }
    if (xcodePaths.length === 1) {
        return { type: "selected", xcodePath: xcodePaths[1] };
    }
    type XcodeQuickPickItem = vscode.QuickPickItem & { inUse: boolean; xcodePath: string };
    const selected = await vscode.window.showQuickPick<XcodeQuickPickItem>(
        SwiftToolchain.getXcodeDeveloperDir(configuration.swiftEnvironmentVariables).then(
            existingDeveloperDir => {
                return xcodePaths
                    .map(xcodePath => {
                        const result: XcodeQuickPickItem = {
                            label: path.basename(xcodePath, ".app"),
                            detail: xcodePath,
                            inUse: false,
                            xcodePath,
                        };
                        if (existingDeveloperDir.startsWith(xcodePath)) {
                            result.description = "$(check) in use";
                            result.inUse = true;
                        }
                        return result;
                    })
                    .sort((a, b) => {
                        // Bring the active Xcode to the top
                        if (existingDeveloperDir.startsWith(a.detail ?? "")) {
                            return -1;
                        } else if (existingDeveloperDir.startsWith(b.detail ?? "")) {
                            return 1;
                        }
                        // Otherwise sort by name
                        return a.label.localeCompare(b.label);
                    });
            }
        ),
        {
            title: "Select a developer directory",
            placeHolder:
                "Pick an Xcode installation to use as the developer directory and for the macOS SDK",
            canPickMany: false,
        }
    );
    if (!selected) {
        return undefined;
    }
    return { type: "selected", xcodePath: selected.xcodePath };
}

/**
 * Prompt the user to choose a value for the DEVELOPER_DIR environment variable.
 *
 * @param xcodePaths An array of paths to available Xcode installations on the system
 * @returns The selected DEVELOPER_DIR or undefined if the user cancelled selection
 */
export async function showDeveloperDirQuickPick(
    xcodePaths: string[]
): Promise<{ developerDir: string | undefined } | undefined> {
    const selectedXcode = await showXcodeQuickPick(xcodePaths);
    if (!selectedXcode) {
        return undefined;
    }
    if (!selectedXcode.xcodePath) {
        return { developerDir: undefined };
    }
    // Find the actual DEVELOPER_DIR based on the selected Xcode app
    return {
        developerDir: await SwiftToolchain.getXcodeDeveloperDir({
            ...process.env,
            DEVELOPER_DIR: selectedXcode.xcodePath,
        }),
    };
}

/**
 * Delete all set Swift path settings.
 */
export async function removeToolchainPath() {
    const swiftSettings = vscode.workspace.getConfiguration("swift");
    const swiftEnvironmentSettings = swiftSettings.inspect("swiftEnvironmentVariables");
    if (swiftEnvironmentSettings?.globalValue) {
        await swiftSettings.update(
            "swiftEnvironmentVariables",
            {
                ...swiftEnvironmentSettings?.globalValue,
                DEVELOPER_DIR: undefined,
            },
            vscode.ConfigurationTarget.Global
        );
    }
    await swiftSettings.update("path", undefined, vscode.ConfigurationTarget.Global);
    if (swiftEnvironmentSettings?.workspaceValue) {
        await swiftSettings.update(
            "swiftEnvironmentVariables",
            {
                ...swiftEnvironmentSettings?.workspaceValue,
                DEVELOPER_DIR: undefined,
            },
            vscode.ConfigurationTarget.Workspace
        );
    }
    await swiftSettings.update("path", undefined, vscode.ConfigurationTarget.Workspace);
}

export async function askWhereToSetToolchain(): Promise<vscode.ConfigurationTarget | undefined> {
    if (!vscode.workspace.workspaceFolders) {
        return vscode.ConfigurationTarget.Global;
    }
    const selected = await vscode.window.showQuickPick(
        [
            {
                label: "Workspace Configuration",
                description: "(Recommended)",
                detail: "Add to VS Code workspace configuration",
                target: vscode.ConfigurationTarget.Workspace,
            },
            {
                label: "Global Configuration",
                detail: "Add to VS Code user configuration",
                target: vscode.ConfigurationTarget.Global,
            },
        ],
        {
            title: "Toolchain Configuration",
            placeHolder: "Select a location to update the toolchain selection",
            canPickMany: false,
        }
    );
    return selected?.target;
}

/**
 * Update the toolchain path
 * @param swiftToolchain
 * @param developerDir
 * @returns
 */
export async function setToolchainPath(
    toolchain: {
        category: SwiftToolchainItem["category"];
        swiftFolderPath?: string;
        onDidSelect?: SwiftToolchainItem["onDidSelect"];
    },
    developerDir?: string,
    target?: vscode.ConfigurationTarget
): Promise<void> {
    target = target ?? (await askWhereToSetToolchain());
    if (!target) {
        return;
    }
    const toolchainPath = toolchain.category !== "swiftly" ? toolchain.swiftFolderPath : undefined;
    const swiftConfiguration = vscode.workspace.getConfiguration("swift");
    await swiftConfiguration.update("path", toolchainPath, target);
    const swiftEnvironmentVariables = {
        ...configuration.swiftEnvironmentVariables,
        DEVELOPER_DIR: developerDir,
    };
    await swiftConfiguration.update(
        "swiftEnvironmentVariables",
        isEmptyObject(swiftEnvironmentVariables) ? undefined : swiftEnvironmentVariables,
        target
    );
    await checkAndRemoveWorkspaceSetting(target);
    if (toolchain.onDidSelect) {
        await toolchain.onDidSelect(target);
    }
}

async function checkAndRemoveWorkspaceSetting(target: vscode.ConfigurationTarget | undefined) {
    // Check to see if the configuration would be overridden by workspace settings
    if (target !== vscode.ConfigurationTarget.Global) {
        return;
    }
    const inspect = vscode.workspace.getConfiguration("swift").inspect<string>("path");
    if (inspect?.workspaceValue) {
        const confirmation = await vscode.window.showWarningMessage(
            "You already have a Swift path configured in Workspace Settings which takes precedence over User Settings." +
                " Would you like to remove the setting from your workspace and use the User Settings instead?",
            "Remove Workspace Setting"
        );
        if (confirmation !== "Remove Workspace Setting") {
            return;
        }
        const swiftSettings = vscode.workspace.getConfiguration("swift");
        const swiftEnvironmentSettings = swiftSettings.inspect("swiftEnvironmentVariables");
        if (swiftEnvironmentSettings?.workspaceValue) {
            await swiftSettings.update(
                "swiftEnvironmentVariables",
                {
                    ...swiftEnvironmentSettings?.workspaceValue,
                    DEVELOPER_DIR: undefined,
                },
                vscode.ConfigurationTarget.Workspace
            );
        }
        await swiftSettings.update("path", undefined, vscode.ConfigurationTarget.Workspace);
    }
}
