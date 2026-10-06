//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as fs from "fs/promises";
import * as vscode from "vscode";

import { InternalSwiftExtensionApi } from "../InternalSwiftExtensionApi";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { removeToolchainPath, selectToolchain } from "../ui/ToolchainSelection";
import { Disposable } from "../utilities/Disposable";

export class SelectedXcodeWatcher implements Disposable {
    public static readonly CHECK_INTERVAL = 2000;
    public static readonly XCODE_SYMLINK_PATH = "/var/select/developer_dir";

    private xcodePath: string | undefined;
    private interval: NodeJS.Timeout | undefined;

    private get logger(): SwiftLogger {
        return this.api.logger;
    }

    constructor(
        private api: InternalSwiftExtensionApi,
        platform: NodeJS.Platform
    ) {
        // Xcode is only available on macOS
        if (platform !== "darwin") {
            return;
        }

        // Deliberately not awaiting this, as we don't want to block the extension activation.
        this.setup().catch(error => {
            this.logger.error(Error("Failed to initialize SelectedXcodeWatcher", { cause: error }));
        });
    }

    dispose() {
        this.logger.trace("Disposing, stopping Xcode symlink polling", {
            label: "SelectedXcodeWatcher",
        });
        clearInterval(this.interval);
    }

    /**
     * Polls the Xcode symlink location checking if it has changed.
     */
    private async setup(): Promise<void> {
        this.xcodePath = await this.resolveXcodeSymlink();
        this.logger.debug(`Initial Xcode symlink path ${this.xcodePath}`);
        this.interval = setInterval(() => {
            void this.checkSelectedXcode();
        }, SelectedXcodeWatcher.CHECK_INTERVAL);
        this.logger.trace(
            `Started polling ${SelectedXcodeWatcher.XCODE_SYMLINK_PATH} every ${SelectedXcodeWatcher.CHECK_INTERVAL}ms`,
            { label: "SelectedXcodeWatcher" }
        );
    }

    private async resolveXcodeSymlink(): Promise<string | undefined> {
        try {
            return await fs.readlink(SelectedXcodeWatcher.XCODE_SYMLINK_PATH);
        } catch (e) {
            return undefined;
        }
    }

    public async checkSelectedXcode(): Promise<void> {
        const oldXcodePath = this.xcodePath;
        const newXcodePath = await this.resolveXcodeSymlink();
        if (!newXcodePath) {
            return;
        }
        // Check if this is a valid change in the Xcode path
        this.xcodePath = newXcodePath;
        if (!oldXcodePath) {
            this.logger.trace(`Xcode symlink path now resolves to ${newXcodePath}`, {
                label: "SelectedXcodeWatcher",
            });
        }
        if (!oldXcodePath || newXcodePath === oldXcodePath) {
            return;
        }
        this.logger.info(`Selected Xcode changed from "${oldXcodePath}" to "${newXcodePath}"`);
        const toolchainManager = this.api.workspaceContext?.globalToolchain.manager ?? "unknown";
        const developerDir = configuration.swiftEnvironmentVariables["DEVELOPER_DIR"];
        this.logger.trace(
            `Xcode change detected: toolchainManager=${toolchainManager}, DEVELOPER_DIR=${developerDir ?? "<unset>"}`,
            { label: "SelectedXcodeWatcher" }
        );
        if (!developerDir && !["swiftly", "swiftenv"].includes(toolchainManager)) {
            this.logger.debug("Reloading workspace context for Xcode change", {
                label: "SelectedXcodeWatcher",
            });
            this.api.reloadWorkspaceContext();
        } else {
            this.logger.debug("Not reloading workspace context for Xcode change", {
                label: "SelectedXcodeWatcher",
            });
        }
        // Warn about potential DEVELOPER_DIR issues
        if (developerDir && !developerDir.startsWith(newXcodePath)) {
            this.logger.trace("DEVELOPER_DIR does not match new Xcode, prompting user", {
                label: "SelectedXcodeWatcher",
            });
            await this.promptToolchainUpdate(
                'The Swift Extension has detected a change in the selected Xcode which does not match the value of your DEVELOPER_DIR in the "swift.swiftEnvironmentVariables" setting. Would you like to update your configured "swift.swiftEnvironmentVariables" setting?'
            );
            return;
        }
        // Warn about potential "swift.path" issues
        if (["xcrun", "swiftly", "swiftenv"].includes(toolchainManager)) {
            this.logger.trace(`Skipping swift.path check for manager ${toolchainManager}`, {
                label: "SelectedXcodeWatcher",
            });
            return;
        }
        const swiftPath = configuration.path;
        if (swiftPath && !swiftPath.startsWith(newXcodePath)) {
            this.logger.trace(`swift.path ${swiftPath} does not match new Xcode, prompting user`, {
                label: "SelectedXcodeWatcher",
            });
            await this.promptToolchainUpdate(
                'The Swift Extension has detected a change in the selected Xcode which does not match the value of your "swift.path" setting. Would you like to update your configured "swift.path" setting?'
            );
        }
    }

    private async promptToolchainUpdate(message: string): Promise<void> {
        const selected = await vscode.window.showWarningMessage(
            message,
            "Remove From Settings",
            "Select Toolchain"
        );
        this.logger.debug(`Xcode change prompt choice: ${selected ?? "<dismissed>"}`, {
            label: "SelectedXcodeWatcher",
        });
        if (selected === "Remove From Settings") {
            await removeToolchainPath();
        } else if (selected === "Select Toolchain") {
            await selectToolchain();
        }
    }
}
