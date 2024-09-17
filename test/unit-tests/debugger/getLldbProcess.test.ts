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

import * as assert from "assert";
import * as util from "../../../src/utilities/utilities";
import * as vscode from "vscode";
import { getLldbProcess } from "../../../src/debugger/lldb";
import { mockNamespace } from "../MockUtils";
import { mock, instance, when, spy, verify, anyString, anything } from "ts-mockito";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";

suite("getLldbProcess Unit Test Suite", () => {
    const utilSpy = spy(util);
    const mockContext = mock(WorkspaceContext);
    const mockToolchain = mock(SwiftToolchain);
    const windowMock = mockNamespace(vscode, "window");

    setup(() => {
        when(mockContext.toolchain).thenReturn(instance(mockToolchain));
        when(mockToolchain.getLLDB()).thenResolve("/path/to/lldb");
    });

    test("should return an empty list when no processes are found", async () => {
        when(utilSpy.execFile(anyString(), anything())).thenResolve({ stdout: "", stderr: "" });

        const result = await getLldbProcess(instance(mockContext));

        assert.deepStrictEqual(result, []);
    });

    test("should return a list with one process", async () => {
        const singleProcessOutput = `1234    5678    user1   group1   SingleProcess\n`;
        when(utilSpy.execFile(anyString(), anything())).thenResolve({
            stdout: singleProcessOutput,
            stderr: "",
        });

        const result = await getLldbProcess(instance(mockContext));

        assert.deepStrictEqual(result, [{ pid: 1234, label: "1234: SingleProcess" }]);
    });

    test("should return a list with many processes", async () => {
        const manyProcessesOutput = Array(1000)
            .fill(0)
            .map((_, i) => {
                return `${1000 + i}    2000    user${i}   group${i}   Process${i}`;
            })
            .join("\n");

        when(utilSpy.execFile(anyString(), anything())).thenResolve({
            stdout: manyProcessesOutput,
            stderr: "",
        });

        const result = await getLldbProcess(instance(mockContext));

        // Assert that the result is an array with 1000 processes
        const expected = Array(1000)
            .fill(0)
            .map((_, i) => ({
                pid: 1000 + i,
                label: `${1000 + i}: Process${i}`,
            }));
        assert.deepStrictEqual(result, expected);
    });

    test("should handle errors correctly", async () => {
        when(utilSpy.execFile(anyString(), anything())).thenReject(new Error("LLDB Error"));

        const result = await getLldbProcess(instance(mockContext));

        assert.strictEqual(result, undefined);

        verify(windowMock.showErrorMessage("Failed to run LLDB: LLDB Error")).once();
    });
});
