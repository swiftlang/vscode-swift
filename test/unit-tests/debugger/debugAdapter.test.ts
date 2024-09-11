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

import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "../../../src/utilities/filesystem";
import { DebugAdapter } from "../../../src/debugger/debugAdapter";
import { mockNamespace } from "../MockUtils";
import { mock, instance, when, spy, verify, anyString, anything } from "ts-mockito";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { Version } from "../../../src/utilities/version";

suite("verifyDebugAdapterExists false return Tests", () => {
    const mockContext = mock(WorkspaceContext);
    const mockToolchain = mock(SwiftToolchain);
    const mockSwift = mock(SwiftOutputChannel);
    const windowStub = mockNamespace(vscode, "window");
    const fsSpy = spy(fs);

    setup(() => {
        when(fsSpy.fileExists(anything())).thenResolve(false);

        // Mock other dependencies in the mockContext
        when(mockContext.toolchain).thenReturn(instance(mockToolchain));
        when(mockContext.outputChannel).thenReturn(instance(mockSwift));
        when(mockToolchain.swiftVersion).thenReturn(new Version(5, 3, 0)); // Any version
    });

    test("should return false regardless of quiet setting", async () => {
        // Test with quiet = true
        const resultQuietTrue = await DebugAdapter.verifyDebugAdapterExists(
            instance(mockContext),
            true
        );
        assert.strictEqual(resultQuietTrue, false, "Should return false when quiet is true");

        // Test with quiet = false
        const resultQuietFalse = await DebugAdapter.verifyDebugAdapterExists(
            instance(mockContext),
            false
        );
        assert.strictEqual(resultQuietFalse, false, "Should return false when quiet is false");
    });

    test("should call showErrorMessage when quiet is false", async () => {
        await DebugAdapter.verifyDebugAdapterExists(instance(mockContext), false);
        verify(windowStub.showErrorMessage(anyString())).called();
    });

    test("should not call showErrorMessage when quiet is true", async () => {
        await DebugAdapter.verifyDebugAdapterExists(instance(mockContext), true);
        verify(windowStub.showErrorMessage(anyString())).never();
    });
});
