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

import * as vscode from "vscode";
import * as assert from "assert";
import * as mocha from "mocha";
import { Api } from "../../../src/extension";
import { testAssetUri } from "../../fixtures";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { FolderContext } from "../../../src/FolderContext";
import { waitForNoRunningTasks } from "../../utilities";

function getRootWorkspaceFolder(): vscode.WorkspaceFolder {
    const result = vscode.workspace.workspaceFolders?.at(0);
    assert(result, "No workspace folders were opened for the tests to use");
    return result;
}

const extensionBootstrapper = (() => {
    let activator: (() => Promise<Api>) | undefined = undefined;
    let activatedAPI: Api | undefined = undefined;
    let lastTestName: string | undefined = undefined;
    let lastTestLogs: string[] = [];
    const testTitle = (currentTest: Mocha.Test) => currentTest.titlePath().join(" → ");

    mocha.afterEach(function () {
        if (this.currentTest && this.currentTest.isFailed()) {
            console.log(`Captured logs during ${testTitle(this.currentTest)}:`);
            if (lastTestLogs.length === 0) {
                console.log("No logs captured.");
            }
            for (const log of lastTestLogs) {
                console.log(log);
            }
        }
    });

    mocha.beforeEach(function () {
        if (this.currentTest && activatedAPI && process.env["VSCODE_TEST"]) {
            activatedAPI.outputChannel.clear();
            activatedAPI.outputChannel.appendLine(`Starting test: ${testTitle(this.currentTest)}`);
        }
    });

    return {
        // Activates the extension and adds the defaultPackage to the workspace.
        // We can only truly call `vscode.Extension<Api>.activate()` once for an entire
        // test run, so after it is called once we switch over to calling activate on
        // the returned API object which behaves like the extension is being launched for
        // the first time _as long as everything is disposed of properly in `deactivate()`_.
        activateExtension: async function (currentTest?: Mocha.Test) {
            if (activatedAPI) {
                throw new Error(
                    `Extension is already activated. Last test that activated the extension: ${lastTestName}`
                );
            }
            const extensionId = "sswg.swift-lang";
            const ext = vscode.extensions.getExtension<Api>(extensionId);
            if (!ext) {
                throw new Error(`Unable to find extension "${extensionId}"`);
            }

            let workspaceContext: WorkspaceContext | undefined;

            // We can only _really_ call activate through
            // `vscode.extensions.getExtension<Api>("sswg.swift-lang")`
            // _once_. Subsequent activations must be done through the returned API object.
            if (!activator) {
                activatedAPI = await ext.activate();
                activator = activatedAPI.activate;
                workspaceContext = activatedAPI.workspaceContext;
            } else {
                activatedAPI = await activator();
                workspaceContext = activatedAPI.workspaceContext;
            }

            if (!workspaceContext) {
                throw new Error("Extension did not activate. Workspace context is not available.");
            }

            // Always adds defaultPackage to the workspace. This may need to be refactored if we want
            // to scope tests more narowly to sub packages within the test assets.
            const workspaceFolder = getRootWorkspaceFolder();
            const packageFolder = testAssetUri("defaultPackage");
            await workspaceContext.addPackageFolder(packageFolder, workspaceFolder);

            // Save the test name so if the test doesn't clean up by deactivating properly the next
            // test that tries to activate can throw an error with the name of the test that needs to clean up.
            lastTestName = currentTest?.fullTitle();

            return workspaceContext;
        },
        deactivateExtension: async () => {
            if (!activatedAPI) {
                throw new Error("Extension is not activated. Call activateExtension() first.");
            }
            lastTestLogs = activatedAPI.outputChannel.logs;

            // Wait for up to 10 seconds for all tasks to complete before deactivating.
            // Long running tasks should be avoided in tests, but this is a safety net.
            await waitForNoRunningTasks({ timeout: 10000 });

            // Close all editors before deactivating the extension.
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");

            await activatedAPI.workspaceContext?.removeWorkspaceFolder(getRootWorkspaceFolder());
            activatedAPI.deactivate();
            activatedAPI = undefined;
            lastTestName = undefined;
        },
    };
})();

/**
 * Activate the extension in tests.
 */
export const activateExtension = extensionBootstrapper.activateExtension;

/**
 * Deactivates the extension in tests.
 */
export const deactivateExtension = extensionBootstrapper.deactivateExtension;

/**
 * Given a name of a folder in the root test workspace, adds that folder to the
 * workspace context and then returns the folder context.
 * @param name The name of the folder in the root workspace
 * @param workspaceContext The existing workspace context
 * @returns The folder context for the folder in the root workspace
 */
export const folderInRootWorkspace = async (
    name: string,
    workspaceContext: WorkspaceContext
): Promise<FolderContext> => {
    const workspaceFolder = getRootWorkspaceFolder();
    let folder = workspaceContext.folders.find(f => f.workspaceFolder.name === `test/${name}`);
    if (!folder) {
        folder = await workspaceContext.addPackageFolder(testAssetUri(name), workspaceFolder);
    }
    return folder;
};

export type SettingsMap = { [key: string]: unknown };

/**
 * Updates VS Code workspace settings and provides a callback to revert them. This
 * should be called before the extension is activated.
 *
 * This function modifies VS Code workspace settings based on the provided
 * `settings` object. Each key in the `settings` object corresponds to a setting
 * name in the format "section.name", and the value is the new setting value to be applied.
 * The original settings are stored, and a callback is returned, which when invoked,
 * reverts the settings back to their original values.
 *
 * @param settings - A map where each key is a string representing the setting name in
 * "section.name" format, and the value is the new setting value.
 * @returns A function that, when called, resets the settings back to their original values.
 */
export async function updateSettings(settings: SettingsMap): Promise<() => Promise<void>> {
    const applySettings = async (settings: SettingsMap) => {
        const savedOriginalSettings: SettingsMap = {};
        Object.keys(settings).forEach(async setting => {
            const { section, name } = decomposeSettingName(setting);
            const config = vscode.workspace.getConfiguration(section, { languageId: "swift" });
            savedOriginalSettings[setting] = config.get(name);
            await config.update(
                name,
                settings[setting] === "" ? undefined : settings[setting],
                vscode.ConfigurationTarget.Workspace
            );
        });

        // There is actually a delay between when the config.update promise resolves and when
        // the setting is actually written. If we exit this function right away the test might
        // start before the settings are actually written. Verify that all the settings are set
        // to their new value before continuing.
        for (const setting of Object.keys(settings)) {
            const { section, name } = decomposeSettingName(setting);
            while (
                vscode.workspace.getConfiguration(section, { languageId: "swift" }).get(name) !==
                settings[setting]
            ) {
                // Not yet, wait a bit and try again.
                await new Promise(resolve => setTimeout(resolve, 30));
            }
        }

        return savedOriginalSettings;
    };

    // Updates the settings
    const savedOriginalSettings = await applySettings(settings);

    // Clients call the callback to reset updated settings to their original value
    return async () => {
        await applySettings(savedOriginalSettings);
    };
}

function decomposeSettingName(setting: string): { section: string; name: string } {
    const splitNames = setting.split(".");
    const name = splitNames.pop();
    const section = splitNames.join(".");
    if (name === undefined) {
        throw new Error(`Invalid setting name: ${setting}, must be in the form swift.settingName`);
    }
    return { section, name };
}
