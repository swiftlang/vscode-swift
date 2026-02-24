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

import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { showReloadExtensionNotification } from "../ui/ReloadExtension";
import { removeToolchainPath, selectToolchain } from "../ui/ToolchainSelection";

export class SelectedXcodeWatcher implements vscode.Disposable {
    private xcodePath: string | undefined;
    private disposed: boolean = false;
    private interval: NodeJS.Timeout | undefined;
    private checkIntervalMs: number;
    private xcodeSymlink: () => Promise<string | undefined>;

    private static DEFAULT_CHECK_INTERVAL_MS = 2000;
    private static XCODE_SYMLINK_LOCATION = "/var/select/developer_dir";

    constructor(
        private logger: SwiftLogger,
        testDependencies?: {
            checkIntervalMs?: number;
            xcodeSymlink?: () => Promise<string | undefined>;
        }
    ) {
        this.checkIntervalMs =
            testDependencies?.checkIntervalMs || SelectedXcodeWatcher.DEFAULT_CHECK_INTERVAL_MS;
        this.xcodeSymlink =
            testDependencies?.xcodeSymlink ||
            (async () => {
                try {
                    return await fs.readlink(SelectedXcodeWatcher.XCODE_SYMLINK_LOCATION);
                } catch (e) {
                    return undefined;
                }
            });

        if (!this.isValidXcodePlatform()) {
            return;
        }

        // Deliberately not awaiting this, as we don't want to block the extension activation.
        void this.setup();
    }

    dispose() {
        this.disposed = true;
        clearInterval(this.interval);
    }

    /**
     * Polls the Xcode symlink location checking if it has changed.
     * If the user has `swift.path` set in their settings this check is skipped.
     */
    private async setup() {
        this.xcodePath = await this.xcodeSymlink();
        this.logger.debug(`Initial Xcode symlink path ${this.xcodePath}`);
        const developerDir = () => configuration.swiftEnvironmentVariables["DEVELOPER_DIR"];
        const matchesPath = (xcodePath: string): boolean =>
            !!configuration.path && configuration.path.startsWith(xcodePath);
        const matchesDeveloperDir = (xcodePath: string): boolean =>
            !!developerDir()?.startsWith(xcodePath);
        if (
            this.xcodePath &&
            (configuration.path || developerDir()) &&
            !(matchesPath(this.xcodePath) || matchesDeveloperDir(this.xcodePath))
        ) {
            this.xcodePath = undefined; // Notify user when initially launching that xcode changed since last session
        }
        this.interval = setInterval(async () => {
            if (this.disposed) {
                return clearInterval(this.interval);
            }

            const newXcodePath = await this.xcodeSymlink();
            if (newXcodePath && this.xcodePath !== newXcodePath) {
                this.logger.info(
                    `Selected Xcode changed from ${this.xcodePath} to ${newXcodePath}`
                );
                this.xcodePath = newXcodePath;
                await this.notifyXcodeChange(
                    this.xcodePath,
                    developerDir(),
                    matchesPath,
                    matchesDeveloperDir
                );
            }
        }, this.checkIntervalMs);
    }

    private async notifyXcodeChange(
        xcodePath: string,
        developerDir: string | undefined,
        matchesPath: (xcodePath: string) => boolean,
        matchesDeveloperDir: (xcodePath: string) => boolean
    ): Promise<void> {
        if (!configuration.path) {
            await showReloadExtensionNotification(
                "The Swift Extension has detected a change in the selected Xcode. Please reload the extension to apply the changes."
            );
            return;
        }

        if (developerDir && !matchesDeveloperDir(xcodePath)) {
            await this.promptToolchainUpdate(
                'The Swift Extension has detected a change in the selected Xcode which does not match the value of your DEVELOPER_DIR in the "swift.swiftEnvironmentVariables" setting. Would you like to update your configured "swift.swiftEnvironmentVariables" setting?'
            );
            return;
        }

        if (!matchesPath(xcodePath)) {
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
        if (selected === "Remove From Settings") {
            await removeToolchainPath();
        } else if (selected === "Select Toolchain") {
            await selectToolchain();
        }
    }

    /**
     * Xcode selection is a macOS only concept.
     */
    private isValidXcodePlatform() {
        return process.platform === "darwin";
    }
}
