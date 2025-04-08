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
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { showReloadExtensionNotification } from "../ui/ReloadExtension";
import configuration from "../configuration";

export class SelectedXcodeWatcher implements vscode.Disposable {
    private xcodePath: string | undefined;
    private disposed: boolean = false;
    private interval: NodeJS.Timeout | undefined;
    private checkIntervalMs: number;
    private xcodeSymlink: () => Promise<string | undefined>;

    private static DEFAULT_CHECK_INTERVAL_MS = 2000;
    private static XCODE_SYMLINK_LOCATION = "/var/select/developer_dir";

    constructor(
        private outputChannel: SwiftOutputChannel,
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
        this.setup();
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
        this.interval = setInterval(async () => {
            if (this.disposed) {
                return clearInterval(this.interval);
            }

            const newXcodePath = await this.xcodeSymlink();
            if (!configuration.path && newXcodePath && this.xcodePath !== newXcodePath) {
                this.outputChannel.appendLine(
                    `Selected Xcode changed from ${this.xcodePath} to ${newXcodePath}`
                );
                this.xcodePath = newXcodePath;
                await showReloadExtensionNotification(
                    "The Swift Extension has detected a change in the selected Xcode. Please reload the extension to apply the changes."
                );
            }
        }, this.checkIntervalMs);
    }

    /**
     * Xcode selection is a macOS only concept.
     */
    private isValidXcodePlatform() {
        return process.platform === "darwin";
    }
}
