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
import * as util from "../../../src/utilities/utilities";
import * as vscode from "vscode";
import { getLldbProcess } from "../../../src/debugger/lldb";
import {
    instance,
    MockedObject,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockObject,
} from "../../MockUtils";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";

suite("getLldbProcess Unit Test Suite", () => {
    const utilMock = mockGlobalModule(util);
    const windowMock = mockGlobalObject(vscode, "window");

    let mockContext: MockedObject<WorkspaceContext>;
    let mockToolchain: MockedObject<SwiftToolchain>;

    setup(() => {
        mockToolchain = mockObject<SwiftToolchain>({
            getLLDB: mockFn(s => s.resolves("/path/to/lldb")),
        });
        mockContext = mockObject<WorkspaceContext>({
            toolchain: instance(mockToolchain),
        });
    });

    test("should return an empty list when no processes are found", async () => {
        utilMock.execFile.resolves({ stdout: "", stderr: "" });

        const result = await getLldbProcess(instance(mockContext));

        expect(result).to.be.an("array").that.is.empty;
    });

    test("should return a list with one process", async () => {
        utilMock.execFile.resolves({
            stdout: `1234    5678    user1   group1   SingleProcess\n`,
            stderr: "",
        });

        const result = await getLldbProcess(instance(mockContext));

        expect(result).to.deep.equal([{ pid: 1234, label: "1234: SingleProcess" }]);
    });

    test("should return a list with many processes", async () => {
        const manyProcessesOutput = Array(1000)
            .fill(0)
            .map((_, i) => {
                return `${1000 + i}    2000    user${i}   group${i}   Process${i}`;
            })
            .join("\n");
        utilMock.execFile.resolves({
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
        expect(result).to.deep.equal(expected);
    });

    test("should handle errors correctly", async () => {
        utilMock.execFile.rejects(new Error("LLDB Error"));
        utilMock.getErrorDescription.returns("LLDB Error");

        const result = await getLldbProcess(instance(mockContext));

        expect(result).to.equal(undefined);
        expect(windowMock.showErrorMessage).to.have.been.calledWith(
            "Failed to run LLDB: LLDB Error"
        );
    });
});
