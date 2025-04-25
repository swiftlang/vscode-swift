//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import configuration from "../configuration";

/**
 * Configures editor.inlayHints.enabled settings based on swift.inlayHints.enabled settings
 */
export async function toggleInlayHints() {
    let settingValue = undefined;

    if (!configuration.inlayHintsEnabled) {
        settingValue = "off";
    }

    const config = vscode.workspace.getConfiguration("", { languageId: "swift" });
    await config.update(
        "editor.inlayHints.enabled",
        settingValue,
        vscode.ConfigurationTarget.Workspace,
        true
    );
}
