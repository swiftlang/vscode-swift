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

import { expect } from "chai";
import * as vscode from "vscode";
import { mockGlobalModule, mockGlobalObject, mockGlobalValue } from "../../MockUtils";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { showToolchainSelectionQuickPick } from "../../../src/ui/ToolchainSelection";

suite("ToolchainSelection Unit Test Suite", () => {
    const mockPlatform = mockGlobalValue(process, "platform");
    const mockStaticSwiftToolchain = mockGlobalModule(SwiftToolchain);
    const mockVSCodeWindow = mockGlobalObject(vscode, "window");

    test("shows avalable Xcode toolchains on macOS", async () => {
        mockPlatform.setValue("darwin");
        mockStaticSwiftToolchain.getXcodeInstalls.resolves([
            "/Applications/Xcode.app",
            "/Applications/Xcode-beta.app",
        ]);
        mockStaticSwiftToolchain.getToolchainInstalls.resolves([]);
        mockStaticSwiftToolchain.getSwiftlyToolchainInstalls.resolves([]);
        mockVSCodeWindow.showQuickPick.callsFake(async items => {
            expect(await items).to.containSubset([
                {
                    label: "Xcode",
                    kind: vscode.QuickPickItemKind.Separator,
                },
                {
                    label: "Xcode",
                    detail: "/Applications/Xcode.app",
                },
                {
                    label: "Xcode-beta",
                    detail: "/Applications/Xcode-beta.app",
                },
                {
                    label: "actions",
                    kind: vscode.QuickPickItemKind.Separator,
                },
                {
                    label: "$(cloud-download) Download from Swift.org...",
                    detail: "Open https://swift.org/install to download and install a toolchain",
                },
                {
                    label: "$(folder-opened) Select toolchain directory...",
                    detail: "Select a folder on your machine where the Swift toolchain is installed",
                },
            ]);
            return undefined;
        });

        await showToolchainSelectionQuickPick();
    });
});
