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
        mockVSCodeWindow.showQuickPick.resolves(undefined);

        await showToolchainSelectionQuickPick();

        expect(mockVSCodeWindow.showQuickPick).to.have.been.calledOnce;
        const xcodeItems = (await mockVSCodeWindow.showQuickPick.args[0][0])
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
    });

    test("shows avalable public toolchains sorted in reverse by Swift version on macOS", async () => {
        mockPlatform.setValue("darwin");
        mockStaticSwiftToolchain.getXcodeInstalls.resolves([]);
        mockStaticSwiftToolchain.getToolchainInstalls.resolves([
            "/Library/Developer/Toolchains/swift-6.0.1-DEVELOPMENT.xctoolchain",
            "/Library/Developer/Toolchains/swift-5.10.1-RELEASE.xctoolchain",
            "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
            "/Library/Developer/Toolchains/swift-5.9.2-RELEASE.xctoolchain",
            "/Library/Developer/swift-latest.xctoolchain",
        ]);
        mockStaticSwiftToolchain.getSwiftlyToolchainInstalls.resolves([]);
        mockVSCodeWindow.showQuickPick.resolves(undefined);

        await showToolchainSelectionQuickPick();

        expect(mockVSCodeWindow.showQuickPick).to.have.been.calledOnce;
        const toolchainItems = (await mockVSCodeWindow.showQuickPick.args[0][0])
            .filter(item => "category" in item && item.category === "public")
            .map(item => ({ label: item.label, detail: item.detail }));
        expect(toolchainItems).to.include.deep.ordered.members([
            {
                label: "Latest Installed Toolchain",
                detail: "/Library/Developer/swift-latest.xctoolchain",
            },
            {
                label: "swift-6.0.1-RELEASE",
                detail: "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
            },
            {
                label: "swift-6.0.1-DEVELOPMENT",
                detail: "/Library/Developer/Toolchains/swift-6.0.1-DEVELOPMENT.xctoolchain",
            },
            {
                label: "swift-5.10.1-RELEASE",
                detail: "/Library/Developer/Toolchains/swift-5.10.1-RELEASE.xctoolchain",
            },
            {
                label: "swift-5.9.2-RELEASE",
                detail: "/Library/Developer/Toolchains/swift-5.9.2-RELEASE.xctoolchain",
            },
        ]);
    });

    test("shows avalable Swiftly toolchains sorted in reverse by Swift version on Linux", async () => {
        mockPlatform.setValue("linux");
        mockStaticSwiftToolchain.getXcodeInstalls.resolves([]);
        mockStaticSwiftToolchain.getToolchainInstalls.resolves([]);
        mockStaticSwiftToolchain.getSwiftlyToolchainInstalls.resolves([
            "/home/user/.swiftly/toolchains/5.10.1",
            "/home/user/.swiftly/toolchains/6.0.1",
            "/home/user/.swiftly/toolchains/5.9.2",
        ]);
        mockVSCodeWindow.showQuickPick.resolves(undefined);

        await showToolchainSelectionQuickPick();

        expect(mockVSCodeWindow.showQuickPick).to.have.been.calledOnce;
        const toolchainItems = (await mockVSCodeWindow.showQuickPick.args[0][0])
            .filter(item => "category" in item && item.category === "swiftly")
            .map(item => ({ label: item.label, detail: item.detail }));
        expect(toolchainItems).to.include.deep.ordered.members([
            {
                label: "6.0.1",
                detail: "/home/user/.swiftly/toolchains/6.0.1",
            },
            {
                label: "5.10.1",
                detail: "/home/user/.swiftly/toolchains/5.10.1",
            },
            {
                label: "5.9.2",
                detail: "/home/user/.swiftly/toolchains/5.9.2",
            },
        ]);
    });
});
