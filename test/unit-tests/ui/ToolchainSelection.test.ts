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

    test("shows avalable Xcode toolchains sorted by path on macOS", async () => {
        mockPlatform.setValue("darwin");
        mockStaticSwiftToolchain.getXcodeInstalls.resolves([
            "/Applications/OlderXcode.app",
            "/Applications/Xcode.app",
            "/Applications/Xcode-beta.app",
        ]);
        mockStaticSwiftToolchain.getToolchainInstalls.resolves([]);
        mockStaticSwiftToolchain.getSwiftlyToolchainInstalls.resolves([]);
        mockVSCodeWindow.showQuickPick.callsFake(async items => {
            const xcodeItems = (await items)
                .filter(item => "category" in item && item.category === "xcode")
                .map(item => ({ label: item.label, detail: item.detail }));
            expect(xcodeItems).to.include.deep.ordered.members([
                {
                    label: "OlderXcode",
                    detail: "/Applications/OlderXcode.app",
                },
                {
                    label: "Xcode",
                    detail: "/Applications/Xcode.app",
                },
                {
                    label: "Xcode-beta",
                    detail: "/Applications/Xcode-beta.app",
                },
            ]);
            return undefined;
        });

        await showToolchainSelectionQuickPick();
    });
});
