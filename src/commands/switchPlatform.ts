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
import { DarwinCompatibleTarget, getDarwinTargetTriple } from "../toolchain/toolchain";
import configuration from "../configuration";

/**
 * Switches the target SDK to the platform selected in a QuickPick UI.
 */
export async function switchPlatform() {
    const picked = await vscode.window.showQuickPick(
        [
            {
                value: undefined,
                label: "macOS",
                description: "default",
            },
            ...[
                { value: DarwinCompatibleTarget.iOS, label: "iOS" },
                { value: DarwinCompatibleTarget.tvOS, label: "tvOS" },
                { value: DarwinCompatibleTarget.watchOS, label: "watchOS" },
                { value: DarwinCompatibleTarget.visionOS, label: "visionOS" },
            ].map(item => ({
                value: getDarwinTargetTriple(item.value),
                description: getDarwinTargetTriple(item.value),
                label: item.label,
            })),
        ],
        {
            placeHolder: "Select a Swift SDK platform",
        }
    );
    if (picked) {
        configuration.swiftSDK = picked.value;
    }
}
