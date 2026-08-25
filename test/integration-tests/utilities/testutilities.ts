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
import * as assert from "assert";
import * as mocha from "mocha";
import * as path from "path";
import { isDeepStrictEqual } from "util";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { InternalSwiftExtensionApi } from "@src/InternalSwiftExtensionApi";
import { FolderOperation, WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { getLLDBLibPath } from "@src/debugger/lldb";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { buildAllTaskName, resetBuildAllTaskCache } from "@src/tasks/SwiftTaskProvider";
import { Extension } from "@src/utilities/extensions";
import { fileExists } from "@src/utilities/filesystem";
import { Version } from "@src/utilities/version";
import { withTimeout } from "@src/utilities/withTimeout";

import { testAssetPath, testAssetUri } from "../../fixtures";
import { attachCapturedLogs } from "../../reporters/utilities";
import { TestLogger } from "../../utilities/TestLogger";
import { closeAllEditors } from "../../utilities/commands";
import { waitForNoRunningTasks } from "../../utilities/tasks";

export function getRootWorkspaceFolder(): vscode.WorkspaceFolder {
    const result = vscode.workspace.workspaceFolders?.at(0);
    assert.ok(result, "No workspace folders were opened for the tests to use");
    return result;
}

/** Configuration for {@link activateExtensionForSuite} and {@link activateExtensionForTest}. */
export interface ExtensionActivationConfig {
    /**
     * The timeout in milliseconds for the `setup` function. Defaults to two minutes.
     *
     * The `setup` function's timeout is enforced by `withTimeout` and not by Mocha, so calling
     * `this.timeout()` from within `setup` has no effect on it. Use this instead for setup
     * functions that need longer than the default.
     */
    setupTimeout?: number;

    /** A function that is called immediately after the Swift extension is activated. */
    setup?: (
        this: Mocha.Context,
        api: InternalSwiftExtensionApi
    ) => Promise<(() => Promise<void>) | void>;

    /**
     * The timeout in milliseconds for the `teardown` function. Defaults to one minute. This also
     * covers the teardown function returned from `setup`, if there is one.
     *
     * The `teardown` function's timeout is enforced by `withTimeout` and not by Mocha, so calling
     * `this.timeout()` from within `teardown` has no effect on it. Use this instead for teardown
     * functions that need longer than the default.
     */
    teardownTimeout?: number;

    /** A function that is called immediately before the Swift extension is deactivated. */
    teardown?: (this: Mocha.Context) => Promise<void>;

    /**
     * The names of the test assets (the package folders under `assets/test`) that the suite needs
     * added to the workspace. Defaults to `["defaultPackage"]`.
     */
    testAssets?: string[];

    /**
     * Set to `true` if the suite requires SourceKit-LSP. The suite will be skipped if SourceKit-LSP
     * is not available.
     */
    requiresLSP?: boolean;

    /**
     * Set to `true` if the suite requires a working debugger. The suite will be skipped if a
     * debugger is not available.
     */
    requiresDebugger?: boolean;
}

const extensionBootstrapper = (() => {
    let activatedAPI: InternalSwiftExtensionApi | undefined = undefined;
    const testTitle = (currentTest: Mocha.Test) => currentTest.titlePath().join(" → ");
    let activationLogger: TestLogger;
    let logOnError: <T>(prefix: string, work: () => Thenable<T> | T) => Promise<T>;

    // Timeouts for the various stages of suite setup and teardown. Mocha gives us no hook to run
    // code when it times out a hook, so these are enforced by `withTimeout` instead, which lets us
    // attach the captured logs to the failure and always reach extension deactivation.
    const SETUP_TIMEOUT_MS = 120_000;
    const USER_SETUP_TIMEOUT_MS = 120_000;
    const TEARDOWN_TIMEOUT_MS = 30_000;
    const USER_TEARDOWN_TIMEOUT_MS = 60_000;
    const DEACTIVATION_TIMEOUT_MS = 20_000;
    const MOCHA_BACKSTOP_MS = 10_000;

    function testRunnerSetup(
        before: Mocha.HookFunction,
        after: Mocha.HookFunction,
        config: ExtensionActivationConfig = {}
    ) {
        const {
            setup,
            teardown,
            testAssets,
            requiresLSP = false,
            requiresDebugger = false,
            setupTimeout = USER_SETUP_TIMEOUT_MS,
            teardownTimeout = USER_TEARDOWN_TIMEOUT_MS,
        } = config;
        let autoTeardown: void | (() => Promise<void>);
        activationLogger = new TestLogger();
        logOnError = withLogging(activationLogger);

        // Extension activation happens asynchronously which means that we need to store the
        // call site of this function to use as the activation site for the extension. This is
        // used so that we know which test didn't clean up its extension activation.
        const callSite = Error("Extension was activated by:");

        before("Activate Swift Extension", async function () {
            // Mocha doesn't give us a hook to run code when a before block times out, so we roll
            // our own timeout to attach logs on failure. Mocha's timeout is kept as a backstop.
            this.timeout(SETUP_TIMEOUT_MS + setupTimeout + MOCHA_BACKSTOP_MS);

            await withTimeout(
                "Swift extension activation",
                async () => {
                    activationLogger.info(`Begin activating extension`);

                    // Make sure that CodeLLDB is installed for debugging related tests
                    if (!vscode.extensions.getExtension("vadimcn.vscode-lldb")) {
                        await logOnError(
                            "vadimcn.vscode-lldb is not installed, installing CodeLLDB extension for the debugging tests.",
                            () =>
                                vscode.commands.executeCommand(
                                    "workbench.extensions.installExtension",
                                    "vadimcn.vscode-lldb"
                                )
                        );
                    }
                    // Always activate the extension. If no test assets are provided,
                    // default to adding `defaultPackage` to the workspace.
                    const api = await extensionBootstrapper.activateExtension(
                        testAssets ?? ["defaultPackage"],
                        callSite
                    );
                    activationLogger.info(`Extension activated successfully.`);

                    const workspaceContext = await api.waitForWorkspaceContext();
                    // Need the `disableSandbox` configuration which is only in 6.1
                    // https://github.com/swiftlang/sourcekit-lsp/commit/7e2d12a7a0d184cc820ae6af5ddbb8aa18b1501c
                    if (
                        process.platform === "darwin" &&
                        workspaceContext.globalToolchain.swiftVersion.isLessThan(
                            new Version(6, 1, 0)
                        ) &&
                        requiresLSP
                    ) {
                        activationLogger.info(`Skipping test, LSP is required but not available.`);
                        this.skip();
                    }
                    if (requiresDebugger && configuration.debugger.disable) {
                        activationLogger.info(
                            `Skipping test, Debugger is required but disabled in the configuration.`
                        );
                        this.skip();
                    }
                    // CodeLLDB does not work with libllbd in Swift toolchains prior to 5.10
                    if (
                        workspaceContext.globalToolchainSwiftVersion.isLessThan(
                            new Version(5, 10, 0)
                        )
                    ) {
                        await logOnError('Setting swift.debugger.setupCodeLLDB: "never"', () =>
                            updateSettings({
                                "swift.debugger.setupCodeLLDB": "never",
                            })
                        );
                    } else if (requiresDebugger) {
                        const lldbLibPath = await logOnError("Getting LLDB library path", () =>
                            getLLDBLibPath(workspaceContext.globalToolchain)
                        );
                        activationLogger.info(
                            `LLDB library path is: ${lldbLibPath.success ?? "not found"}`
                        );
                    }

                    // Make sure no running tasks before setting up
                    await waitForNoRunningTasks();

                    // Clear build all cache before starting suite
                    resetBuildAllTaskCache();
                },
                SETUP_TIMEOUT_MS
            ).catch(error => {
                if (this.test) {
                    attachCapturedLogs(this.test, activationLogger.logs);
                }
                throw error;
            });

            if (setup) {
                // If the setup returns a promise it is used to undo whatever setup it did.
                // Typically this is the promise returned from `updateSettings`, which will
                // undo any settings changed during setup.
                autoTeardown = await withTimeout(
                    "Test provided setup function",
                    () =>
                        logOnError(
                            "Calling user defined setup method to configure test/suite specifics",
                            () => setup.call(this, activatedAPI!)
                        ),
                    setupTimeout
                ).catch(error => {
                    if (this.test) {
                        attachCapturedLogs(this.test, activationLogger.logs);
                    }
                    throw error;
                });
            }

            activationLogger.info("Activation complete!");
        });

        mocha.beforeEach(function () {
            if (this.currentTest) {
                activationLogger.info(`Starting test: ${testTitle(this.currentTest)}`);
            }
        });

        mocha.afterEach(async function () {
            if (this.currentTest) {
                activationLogger.info(`Test finished: ${testTitle(this.currentTest)}`);
                attachCapturedLogs(this.currentTest, activationLogger.logs);
            }
            if (vscode.debug.activeDebugSession) {
                await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
            }
        });

        after("Deactivate Swift Extension", async function () {
            // Mocha doesn't allow us to perform any actions when a timeout happens, so each stage
            // below rolls its own timeout instead. This lets us:
            //   a) Attach debugging info such as logs when a timeout happens
            //   b) Make sure that the InternalSwiftApi's deactivate() method is called to avoid breaking subsequent tests
            // Mocha's timeout is kept as a backstop in case one of those stages fails to time out.
            this.timeout(
                teardownTimeout + TEARDOWN_TIMEOUT_MS + DEACTIVATION_TIMEOUT_MS + MOCHA_BACKSTOP_MS
            );

            activationLogger.info("Deactivating extension...");

            let userTeardownError: unknown | undefined;
            try {
                await withTimeout(
                    "Test provided teardown function",
                    async () => {
                        // First run the users supplied teardown, then await the autoTeardown if it exists.
                        if (teardown) {
                            await logOnError("Running user teardown function...", () =>
                                teardown.call(this)
                            );
                        }
                        if (autoTeardown) {
                            await logOnError(
                                "Running auto teardown function (function returned from setup)...",
                                () => autoTeardown!()
                            );
                        }
                    },
                    teardownTimeout
                );
            } catch (error) {
                // We always want to restore settings and deactivate the extension even if the
                // user supplied teardown fails. That way we have the best chance at not causing
                // issues with the next test.
                //
                // Store the error and re-throw it after extension deactivation.
                userTeardownError = error;
            }

            activationLogger.info("Deactivation complete, calling deactivateExtension()");
            try {
                await extensionBootstrapper.deactivateExtension();
            } catch (error) {
                if (this.test) {
                    // `deactivateExtension` throws on a deactivation timeout (or any other
                    // failure). The surrounding test has usually passed, so the per-test afterEach
                    // log capture won't fire. Attach the logs to this hook so the reporter still
                    // prints them.
                    attachCapturedLogs(this.test, activationLogger.logs);
                }
                throw error;
            }
            activationLogger.clear();

            // Re-throw the user supplied teardown error
            if (userTeardownError) {
                throw userTeardownError;
            }
        });
    }

    return {
        // Activates the extension and adds the defaultPackage to the workspace.
        // We can only truly call `vscode.Extension<InternalApi>.activate()` once for an entire
        // test run, so after it is called once we switch over to calling activate on
        // the returned API object which behaves like the extension is being launched for
        // the first time _as long as everything is disposed of properly in `deactivate()`_.
        async activateExtension(
            testAssets?: string[],
            callSite?: Error
        ): Promise<InternalSwiftExtensionApi> {
            const extensionId = "swiftlang.swift-vscode";
            const ext = vscode.extensions.getExtension<InternalSwiftExtensionApi>(extensionId);
            if (!ext) {
                throw new Error(`Unable to find extension "${extensionId}"`);
            }

            // We can only _really_ call activate through
            // `vscode.extensions.getExtension<InternalApi>("swiftlang.swift-vscode")` once.
            // Subsequent activations must be done through the returned API object.
            if (!activatedAPI) {
                activationLogger.info(
                    "Performing the one and only extension activation for this test run."
                );
                for (const depId of [Extension.CODELLDB, Extension.LLDBDAP]) {
                    const dep = vscode.extensions.getExtension<InternalSwiftExtensionApi>(depId);
                    if (!dep) {
                        throw new Error(`Unable to find extension "${depId}"`);
                    }
                    await logOnError(`Activating dependency extension "${depId}".`, () =>
                        dep.activate()
                    );
                }

                activatedAPI = await logOnError(
                    "Activating Swift extension (true activation)...",
                    () => ext.activate()
                );
                activatedAPI.logger.addTransport(activationLogger.createTransport());
            } else {
                await logOnError(
                    "Activating Swift extension by re-calling the extension's activation method...",
                    () => activatedAPI!.activate(callSite)
                );
            }

            if (!activatedAPI) {
                throw new Error("Extension did not activate. Workspace context is not available.");
            }

            // Add assets required for the suite/test to the workspace.
            const workspaceContext = await activatedAPI.waitForWorkspaceContext();
            const expectedAssets = testAssets ?? ["defaultPackage"];
            if (!vscode.workspace.workspaceFile) {
                activationLogger.info(`No workspace file found, adding assets directly.`);
                for (const asset of expectedAssets) {
                    await logOnError(`Adding ${asset} to workspace...`, () =>
                        folderInRootWorkspace(asset, workspaceContext)
                    );
                }
                activationLogger.info(`All assets added to workspace.`);
            } else if (expectedAssets.length > 0) {
                await new Promise<void>(res => {
                    const found: string[] = [];
                    for (const f of workspaceContext.folders) {
                        if (found.includes(f.name) || !expectedAssets.includes(f.name)) {
                            continue;
                        }
                        activationLogger.info(`Added ${f.name} to workspace`);
                        found.push(f.name);
                    }
                    if (expectedAssets.length === found.length) {
                        res();
                        return;
                    }
                    const disposable = workspaceContext.onDidChangeFolders(e => {
                        if (
                            e.operation !== FolderOperation.add ||
                            found.includes(e.folder!.name) ||
                            !expectedAssets.includes(e.folder!.name)
                        ) {
                            return;
                        }
                        activationLogger.info(`Added ${e.folder!.name} to workspace`);
                        found.push(e.folder!.name);
                        if (expectedAssets.length === found.length) {
                            res();
                            disposable.dispose();
                        }
                    });
                });
                activationLogger.info(`All assets added to workspace.`);
            }

            // Swift packages are loaded asynchronously. Make sure that all of them are fully loaded
            // before continuing.
            await Promise.all(
                workspaceContext.folders.map(async folder => folder.swiftPackage.foundPackage)
            );

            return activatedAPI;
        },
        async deactivateExtension(): Promise<void> {
            if (!activatedAPI) {
                throw new Error("Extension is not activated. Call activateExtension() first.");
            }

            let teardownError: unknown | undefined;
            await withTimeout(
                "Swift extension teardown",
                async () => {
                    // Close all editors before deactivating the extension.
                    await logOnError(`Closing all editors.`, () => closeAllEditors());

                    await logOnError(`Removing root workspace folder.`, async () =>
                        activatedAPI!.workspaceContext?.removeWorkspaceFolder(
                            getRootWorkspaceFolder()
                        )
                    );
                },
                TEARDOWN_TIMEOUT_MS
            ).catch(error => {
                // We always want to call deactivate() even if there was an error. Store it and throw it later.
                teardownError = error;
            });

            await logOnError("Running extension deactivate() function", () =>
                withTimeout(
                    "Swift extension deactivate() function",
                    () => activatedAPI!.deactivate(),
                    DEACTIVATION_TIMEOUT_MS
                )
            ).catch(deactivationError => {
                if (teardownError) {
                    return;
                }
                throw deactivationError;
            });

            if (teardownError) {
                throw teardownError;
            }

            activationLogger.clear();
        },

        activateExtensionForSuite: function (config?: ExtensionActivationConfig) {
            testRunnerSetup(mocha.before, mocha.after, config);
        },

        activateExtensionForTest: function (config?: ExtensionActivationConfig) {
            testRunnerSetup(mocha.beforeEach, mocha.afterEach, config);
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
    let folder = workspaceContext.folders.find(f => f.relativePath === name);
    if (!folder) {
        workspaceContext.logger.info(`${name} not found, adding folder ${name} to workspace`);
        folder = await workspaceContext.addPackageFolder(testAssetUri(name), workspaceFolder);
    } else {
        workspaceContext.logger.info(`${name} found, reusing existing folder`);
    }

    // Folders that aren't packages (i.e. assets/tests/scripts) wont generate build tasks.
    if (!(await fileExists(path.join(testAssetUri(name).fsPath, "Package.swift")))) {
        return folder;
    }

    let i = 0;
    while (i++ < 5) {
        const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
        const buildAllName = buildAllTaskName(folder, false);
        if (tasks.find(t => t.name === buildAllName)) {
            break;
        }
        await new Promise(r => setTimeout(r, 5000));
    }
    return folder;
};

export function findWorkspaceFolder(
    name: string,
    workspaceContext: WorkspaceContext
): FolderContext | undefined {
    return workspaceContext.folders.find(f => f.folder.fsPath === testAssetPath(name));
}

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
        for (const setting of Object.keys(settings)) {
            const { section, name } = decomposeSettingName(setting);
            const config = vscode.workspace.getConfiguration(section, { languageId: "swift" });
            const inspectedSetting = vscode.workspace
                .getConfiguration(section, { languageId: "swift" })
                .inspect(name);
            savedOriginalSettings[setting] = inspectedSetting?.workspaceValue;
            await config.update(
                name,
                !settings[setting] ? undefined : settings[setting],
                vscode.ConfigurationTarget.Workspace
            );
        }

        // There is actually a delay between when the config.update promise resolves and when
        // the setting is actually written. If we exit this function right away the test might
        // start before the settings are actually written. Verify that all the settings are set
        // to their new value before continuing.
        for (const setting of Object.keys(settings)) {
            const { section, name } = decomposeSettingName(setting);
            // If the setting is being unset then its possible the setting will evaluate to the
            // default value, and so we should be checking to see if its switched to that instead.
            const expected = !settings[setting]
                ? (vscode.workspace.getConfiguration(section, { languageId: "swift" }).inspect(name)
                      ?.defaultValue ?? settings[setting])
                : settings[setting];

            while (
                !isConfigurationSuperset(
                    vscode.workspace.getConfiguration(section, { languageId: "swift" }).get(name),
                    expected
                )
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

/**
 * Performs a deep comparison between a configuration value and an expected value.
 * Supports superset comparisons for objects and arrays, and strict equality for primitives.
 *
 * @param configValue The configuration value to compare
 * @param expected The expected value to compare against
 * @returns true if the configuration value matches or is a superset of the expected value, false otherwise
 */
export function isConfigurationSuperset(configValue: unknown, expected: unknown): boolean {
    // Handle null cases
    if (configValue === null || expected === null) {
        return configValue === expected;
    }

    // If both values are undefined, they are considered equal
    if (configValue === undefined && expected === undefined) {
        return true;
    }

    // If expected is undefined but configValue is not, they are not equal
    if (expected === undefined) {
        return false;
    }

    // If configValue is undefined but expected is not, they are not equal
    if (configValue === undefined) {
        return false;
    }

    // Use isDeepStrictEqual for primitive types
    if (typeof configValue !== "object" || typeof expected !== "object") {
        return isDeepStrictEqual(configValue, expected);
    }

    // Handle arrays
    if (Array.isArray(configValue) && Array.isArray(expected)) {
        // Check if configValue contains all elements from expected
        return expected.every(expectedItem =>
            configValue.some(configItem => isConfigurationSuperset(configItem, expectedItem))
        );
    }

    // Handle objects
    if (
        typeof configValue === "object" &&
        typeof expected === "object" &&
        !!configValue &&
        !!expected &&
        !Array.isArray(configValue) &&
        !Array.isArray(expected)
    ) {
        // Ensure we're working with plain objects
        const configObj = configValue as Record<string, unknown>;
        const expectedObj = expected as Record<string, unknown>;

        // Check if all expected properties exist in configValue with matching or superset values
        return Object.keys(expectedObj).every(key => {
            // If the key doesn't exist in configValue, return false
            if (!(key in configObj)) {
                return false;
            }

            // Recursively check the value
            return isConfigurationSuperset(configObj[key], expectedObj[key]);
        });
    }

    // If types don't match (one is array, one is object), return false
    return false;
}

/**
 * Creates a logging wrapper function that wraps async operations with prefixed start/end logging messages.
 * Logs when the operation starts, completes successfully, or fails with an error.
 *
 * @param logger The logger object that must have an `info` method for logging messages
 * @returns A wrapper function that takes a prefix and async work function, returning a promise that resolves to the result of the async work
 */
export function withLogging(logger: SwiftLogger) {
    return async function <T>(prefix: string, work: () => Thenable<T> | T): Promise<T> {
        logger.info(`${prefix} - starting`);
        try {
            const result = await work();
            logger.info(`${prefix} - completed`);
            return result;
        } catch (error) {
            logger.error(Error(`${prefix} - failed`, { cause: error }));
            throw error;
        }
    };
}
