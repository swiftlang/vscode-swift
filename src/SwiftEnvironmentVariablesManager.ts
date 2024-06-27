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
import { SwiftToolchain } from "./toolchain/toolchain";
import configuration from "./configuration";

/** The separator to use between paths in the PATH environment variable */
const pathSeparator: string = process.platform === "win32" ? ";" : ":";

/**
 * Configures Swift environment variables for VS Code. Will automatically update
 * whenever the configuration changes.
 */
export class SwiftEnvironmentVariablesManager implements vscode.Disposable {
    private subscriptions: vscode.Disposable[];

    constructor(
        private context: vscode.ExtensionContext,
        private toolchain: SwiftToolchain
    ) {
        this.update();
        this.subscriptions = [
            vscode.workspace.onDidChangeConfiguration(event => {
                if (
                    event.affectsConfiguration("swift.path") ||
                    event.affectsConfiguration("swift.swiftEnvironmentVariables")
                ) {
                    this.update();
                }
            }),
        ];
    }

    dispose() {
        this.context.environmentVariableCollection.clear();
        for (const disposable of this.subscriptions) {
            disposable.dispose();
        }
    }

    private update() {
        this.context.environmentVariableCollection.clear();
        this.context.environmentVariableCollection.prepend(
            "PATH",
            this.toolchain.swiftFolderPath + pathSeparator
        );
        for (const variable in configuration.swiftEnvironmentVariables) {
            this.context.environmentVariableCollection.replace(
                variable,
                configuration.swiftEnvironmentVariables[variable]
            );
        }
    }
}
