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
import * as lldb from "../../../src/debugger/lldb";
import { attachDebugger } from "../../../src/commands/attachDebugger";
import { mockNamespace } from "../MockUtils";
import {
    mock,
    instance,
    when,
    spy,
    verify,
    anything,
    deepEqual,
    objectContaining,
} from "ts-mockito";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { registerLLDBDebugAdapter } from "../../../src/debugger/debugAdapterFactory";

suite("attachDebugger Unit Test Suite with Thenable Capture", () => {
    const lldbSpy = spy(lldb);
    const mockContext = mock(WorkspaceContext);
    const mockToolchain = mock(SwiftToolchain);
    const windowMock = mockNamespace(vscode, "window");
    const debugMock = mockNamespace(vscode, "debug");

    setup(() => {
        when(mockContext.toolchain).thenReturn(instance(mockToolchain));
    });

    test("should call startDebugging with correct debugConfig and capture the return Thenable", async () => {
        // Setup fake debug adapter
        registerLLDBDebugAdapter(instance(mockContext));

        // Mock the list of processes returned by getLldbProcess
        const processPickItems = [
            { pid: 1234, label: "1234: Process1" },
            { pid: 2345, label: "2345: Process2" },
        ];
        when(lldbSpy.getLldbProcess(anything())).thenResolve(processPickItems);

        // Mock showQuickPick to return a selected process.
        // It's unfortunate that anthing will match the wrong function, so we have to hard code which makes the test more brittle.
        // So just change here when the test starts failing.
        when(
            windowMock.showQuickPick(
                deepEqual(processPickItems),
                deepEqual({ placeHolder: "Select Process" })
            ) as Promise<(typeof processPickItems)[0]>
        ).thenResolve(processPickItems[0]);

        // Call attachDebugger
        await attachDebugger(instance(mockContext));

        // Verify startDebugging was called with the right pid.
        // Integration level check needed: actual config return a fulfilled promise.
        verify(
            debugMock.startDebugging(undefined, objectContaining(processPickItems[0].pid))
        ).once();
    });
});
