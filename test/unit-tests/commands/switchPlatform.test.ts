//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
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

import { WorkspaceContext } from "@src/WorkspaceContext";
import { switchPlatform } from "@src/commands/switchPlatform";
import configuration from "@src/configuration";
import { DarwinCompatibleTarget, getDarwinTargetTriple } from "@src/toolchain/SwiftToolchain";
import { ToolchainService } from "@src/toolchain/ToolchainService";
import { StatusItem } from "@src/ui/StatusItem";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockObject,
} from "../../MockUtils";

suite("Switch Target Platform Unit Tests", () => {
    const mockedConfiguration = mockGlobalModule(configuration);
    const windowMock = mockGlobalObject(vscode, "window");
    let mockedToolchainService: MockedObject<ToolchainService>;
    let mockContext: MockedObject<WorkspaceContext>;
    let mockedStatusItem: MockedObject<StatusItem>;

    setup(() => {
        mockedToolchainService = mockObject<ToolchainService>({
            getSDKForTarget: mockFn(),
        });
        mockedStatusItem = mockObject<StatusItem>({
            start: mockFn(),
            end: mockFn(),
        });
        mockContext = mockObject<WorkspaceContext>({
            statusItem: instance(mockedStatusItem),
            toolchainService: mockedToolchainService,
        });
    });

    test("Call Switch Platform and switch to iOS", async () => {
        const selectedItem = { value: DarwinCompatibleTarget.iOS, label: "iOS" };
        windowMock.showQuickPick.resolves(selectedItem);
        mockedToolchainService.getSDKForTarget.resolves("");
        expect(mockedConfiguration.swiftSDK).to.equal("");

        await switchPlatform(instance(mockContext));

        expect(windowMock.showQuickPick).to.have.been.calledOnce;
        expect(windowMock.showWarningMessage).to.have.been.calledOnceWithExactly(
            "Selecting the iOS target platform will provide code editing support, but compiling with a iOS SDK will have undefined results."
        );
        expect(mockedStatusItem.start).to.have.been.called;
        expect(mockedStatusItem.end).to.have.been.called;
        expect(mockedConfiguration.swiftSDK).to.equal(
            getDarwinTargetTriple(DarwinCompatibleTarget.iOS)
        );
    });

    test("Call Switch Platform and switch to macOS", async () => {
        const selectedItem = { value: undefined, label: "macOS" };
        windowMock.showQuickPick.resolves(selectedItem);
        mockedToolchainService.getSDKForTarget.resolves("");
        expect(mockedConfiguration.swiftSDK).to.equal("");

        await switchPlatform(instance(mockContext));

        expect(windowMock.showQuickPick).to.have.been.calledOnce;
        expect(windowMock.showWarningMessage).to.not.have.been.called;
        expect(mockedStatusItem.start).to.have.been.called;
        expect(mockedStatusItem.end).to.have.been.called;
        expect(mockedConfiguration.swiftSDK).to.equal("");
    });
});
