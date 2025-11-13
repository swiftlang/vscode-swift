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
import * as sinon from "sinon";

import * as lldb from "@src/debugger/lldb";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as util from "@src/utilities/utilities";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalModule,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";

suite("debugger.lldb Tests", () => {
    suite("getLLDBLibPath()", () => {
        let mockToolchain: MockedObject<SwiftToolchain>;
        const mockedPlatform = mockGlobalValue(process, "platform");
        const mockUtil = mockGlobalModule(util);

        setup(() => {
            mockToolchain = mockObject<SwiftToolchain>({
                getLLDB: mockFn(),
                toolchainPath: "",
            });
        });

        teardown(() => {
            sinon.restore();
        });

        test("should return failure if toolchain.getLLDB() throws an error", async () => {
            mockToolchain.getLLDB.rejects(new Error("Failed to get LLDB"));
            const result = await lldb.getLLDBLibPath(instance(mockToolchain));
            expect(result.failure).to.have.property("message", "Failed to get LLDB");
        });

        test("should return failure when execFile throws an error on windows", async () => {
            mockedPlatform.setValue("win32");
            mockToolchain.getLLDB.resolves("/path/to/lldb");
            mockUtil.execFile.rejects(new Error("execFile failed"));
            const result = await lldb.getLLDBLibPath(instance(mockToolchain));
            // specific behaviour: return success and failure both undefined
            expect(result.failure).to.equal(undefined);
            expect(result.success).to.equal(undefined);
        });
    });
});
