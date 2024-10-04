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

import { expect } from "chai";
import * as vscode from "vscode";
import * as lldb from "../../../src/debugger/lldb";
import { attachDebugger } from "../../../src/commands/attachDebugger";
import {
    mockObject,
    mockGlobalObject,
    mockGlobalModule,
    MockedObject,
    instance,
} from "../../MockUtils";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { registerLLDBDebugAdapter } from "../../../src/debugger/debugAdapterFactory";
import { Version } from "../../../src/utilities/version";

suite("attachDebugger Unit Test Suite", () => {
    const lldbMock = mockGlobalModule(lldb);
    const windowMock = mockGlobalObject(vscode, "window");
    const debugMock = mockGlobalObject(vscode, "debug");

    let mockContext: MockedObject<WorkspaceContext>;
    let mockToolchain: MockedObject<SwiftToolchain>;

    setup(() => {
        mockToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
        });
        mockContext = mockObject<WorkspaceContext>({
            toolchain: instance(mockToolchain),
        });
    });

    test("should call startDebugging with correct debugConfig", async () => {
        // Setup fake debug adapter
        registerLLDBDebugAdapter(instance(mockContext));

        // Mock the list of processes returned by getLldbProcess
        const processPickItems = [
            { pid: 1234, label: "1234: Process1" },
            { pid: 2345, label: "2345: Process2" },
        ];
        lldbMock.getLldbProcess.resolves(processPickItems);
        windowMock.showQuickPick.callsFake(async items => (await items)[0]);

        // Call attachDebugger
        await attachDebugger(instance(mockContext));

        // Verify startDebugging was called with the right pid.
        // NB(separate itest): actual config return a fulfilled promise.
        expect(debugMock.startDebugging).to.have.been.calledOnce;
        expect(debugMock.startDebugging.args[0][1]).to.containSubset({ pid: 1234 });
    });
});
