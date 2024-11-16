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

import * as vscode from "vscode";
import { DarwinCompatibleTarget, SwiftToolchain } from "../toolchain/toolchain";
import configuration from "../configuration";

/**
 * Switches the target SDK to the platform selected in a QuickPick UI.
 */
export async function switchPlatform() {
    const picked = await vscode.window.showQuickPick(
        [
            { value: undefined, label: "macOS" },
            { value: DarwinCompatibleTarget.iOS, label: "iOS" },
            { value: DarwinCompatibleTarget.tvOS, label: "tvOS" },
            { value: DarwinCompatibleTarget.watchOS, label: "watchOS" },
            { value: DarwinCompatibleTarget.visionOS, label: "visionOS" },
        ],
        {
            placeHolder: "Select a new target",
        }
    );
    if (picked) {
        try {
            const sdkForTarget = picked.value
                ? await SwiftToolchain.getSDKForTarget(picked.value)
                : "";
            if (sdkForTarget !== undefined) {
                if (sdkForTarget !== "") {
                    configuration.sdk = sdkForTarget;
                    vscode.window.showWarningMessage(
                        `Selecting the ${picked.label} SDK will provide code editing support, but compiling with this SDK will have undefined results.`
                    );
                } else {
                    configuration.sdk = undefined;
                }
            } else {
                vscode.window.showErrorMessage("Unable to obtain requested SDK path");
            }
        } catch {
            vscode.window.showErrorMessage("Unable to obtain requested SDK path");
        }
    }
}
