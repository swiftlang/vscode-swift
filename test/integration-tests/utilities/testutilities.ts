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
import { waitForNoRunningTasks } from "../../utilities/tasks";
import { closeAllEditors } from "../../utilities/commands";
import { isDeepStrictEqual } from "util";
import { Version } from "../../../src/utilities/version";
import configuration from "../../../src/configuration";

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

    function testRunnerSetup(
        before: Mocha.HookFunction,
        setup:
            | ((
                  this: Mocha.Context,
                  ctx: WorkspaceContext
              ) => Promise<(() => Promise<void>) | void>)
            | undefined,
        after: Mocha.HookFunction,
        teardown: ((this: Mocha.Context) => Promise<void>) | undefined,
        testAssets?: string[],
        requiresLSP: boolean = false,
        requiresDebugger: boolean = false
    ) {
        let workspaceContext: WorkspaceContext | undefined;
        let autoTeardown: void | (() => Promise<void>);
        let restoreSettings: (() => Promise<void>) | undefined;
        before(async function () {
            // Always activate the extension. If no test assets are provided,
            // default to adding `defaultPackage` to the workspace.
            workspaceContext = await extensionBootstrapper.activateExtension(
                this.currentTest,
                testAssets ?? ["defaultPackage"]
            );
            // Need the `disableSandbox` configuration which is only in 6.1
            // https://github.com/swiftlang/sourcekit-lsp/commit/7e2d12a7a0d184cc820ae6af5ddbb8aa18b1501c
            if (
                process.platform === "darwin" &&
                workspaceContext.toolchain.swiftVersion.isLessThan(new Version(6, 1, 0)) &&
                requiresLSP
            ) {
                this.skip();
            }
            if (requiresDebugger && configuration.debugger.disable) {
                this.skip();
            }
            // CodeLLDB does not work with libllbd in Swift toolchains prior to 5.10
            if (workspaceContext.swiftVersion.isLessThan(new Version(5, 10, 0))) {
                restoreSettings = await updateSettings({
                    "swift.debugger.setupCodeLLDB": "never",
                });
            }
            if (!setup) {
                return;
            }
            try {
                // If the setup returns a promise it is used to undo whatever setup it did.
                // Typically this is the promise returned from `updateSettings`, which will
                // undo any settings changed during setup.
                autoTeardown = await setup.call(this, workspaceContext);
            } catch (error: any) {
                // Mocha will throw an error to break out of a test if `.skip` is used.
                if (error.message?.indexOf("sync skip;") === -1) {
                    console.error(`Error during test/suite setup: ${JSON.stringify(error)}`);
                    console.error("Captured logs are:");
                    workspaceContext.outputChannel.logs.map(log => console.error(log));
                    console.error("================ end test logs ================");
                }
                throw error;
            }
        });

        after(async function () {
            try {
                // First run the users supplied teardown, then await the autoTeardown if it exists.
                if (teardown) {
                    await teardown.call(this);
                }
                if (autoTeardown) {
                    await autoTeardown();
                }
                if (restoreSettings) {
                    await restoreSettings();
                }
            } catch (error) {
                if (workspaceContext) {
                    console.error(`Error during test/suite teardown, captured logs are:`);
                    workspaceContext.outputChannel.logs.map(log => console.log(log));
                }
                throw error;
            }

            await extensionBootstrapper.deactivateExtension();
        });
    }

    return {
        // Activates the extension and adds the defaultPackage to the workspace.
        // We can only truly call `vscode.Extension<Api>.activate()` once for an entire
        // test run, so after it is called once we switch over to calling activate on
        // the returned API object which behaves like the extension is being launched for
        // the first time _as long as everything is disposed of properly in `deactivate()`_.
        activateExtension: async function (currentTest?: Mocha.Test, testAssets?: string[]) {
            if (activatedAPI) {
                throw new Error(
                    `Extension is already activated. Last test that activated the extension: ${lastTestName}`
                );
            }
            const extensionId = "swiftlang.swift-vscode";
            const ext = vscode.extensions.getExtension<Api>(extensionId);
            if (!ext) {
                throw new Error(`Unable to find extension "${extensionId}"`);
            }

            let workspaceContext: WorkspaceContext | undefined;

            // We can only _really_ call activate through
            // `vscode.extensions.getExtension<Api>("swiftlang.swift-vscode")` once.
            // Subsequent activations must be done through the returned API object.
            if (!activator) {
                activatedAPI = await ext.activate();
                // Save the test name so if the test doesn't clean up by deactivating properly the next
                // test that tries to activate can throw an error with the name of the test that needs to clean up.
                lastTestName = currentTest?.titlePath().join(" → ");
                activator = activatedAPI.activate;
                workspaceContext = activatedAPI.workspaceContext;
            } else {
                activatedAPI = await activator();
                lastTestName = currentTest?.titlePath().join(" → ");
                workspaceContext = activatedAPI.workspaceContext;
            }

            if (!workspaceContext) {
                throw new Error("Extension did not activate. Workspace context is not available.");
            }

            // Add assets required for the suite/test to the workspace.
            const workspaceFolder = getRootWorkspaceFolder();
            for (const asset of testAssets ?? []) {
                const packageFolder = testAssetUri(asset);
                await workspaceContext.addPackageFolder(packageFolder, workspaceFolder);
            }

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
            closeAllEditors();

            await activatedAPI.workspaceContext?.removeWorkspaceFolder(getRootWorkspaceFolder());
            await activatedAPI.deactivate();
            activatedAPI = undefined;
            lastTestName = undefined;
        },

        activateExtensionForSuite: async function (config?: {
            setup?: (
                this: Mocha.Context,
                ctx: WorkspaceContext
            ) => Promise<(() => Promise<void>) | void>;
            teardown?: (this: Mocha.Context) => Promise<void>;
            testAssets?: string[];
            requiresLSP?: boolean;
            requiresDebugger?: boolean;
        }) {
            testRunnerSetup(
                mocha.before,
                config?.setup,
                mocha.after,
                config?.teardown,
                config?.testAssets,
                config?.requiresLSP,
                config?.requiresDebugger
            );
        },

        activateExtensionForTest: async function (config?: {
            setup?: (
                this: Mocha.Context,
                ctx: WorkspaceContext
            ) => Promise<(() => Promise<void>) | void>;
            teardown?: (this: Mocha.Context) => Promise<void>;
            testAssets?: string[];
            requiresLSP?: boolean;
            requiresDebugger?: boolean;
        }) {
            testRunnerSetup(
                mocha.beforeEach,
                config?.setup,
                mocha.afterEach,
                config?.teardown,
                config?.testAssets,
                config?.requiresLSP,
                config?.requiresDebugger
            );
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
 * Activates the extension for the duration of the suite, deactivating it when the suite completes.
 */
export const activateExtensionForSuite = extensionBootstrapper.activateExtensionForSuite;

/*
 * Activates the extension for the duration of the test, deactivating it when the test completes.
 */
export const activateExtensionForTest = extensionBootstrapper.activateExtensionForTest;

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
                isDeepStrictEqual(
                    vscode.workspace.getConfiguration(section, { languageId: "swift" }).get(name),
                    settings[setting]
                ) === false
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
