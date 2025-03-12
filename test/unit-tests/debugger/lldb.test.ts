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

import * as util from "../../../src/utilities/utilities";
import * as lldb from "../../../src/debugger/lldb";
import * as fs from "fs/promises";
import * as sinon from "sinon";
import { expect } from "chai";
import {
    instance,
    MockedObject,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockObject,
    MockedFunction,
    mockGlobalValue,
} from "../../MockUtils";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";

suite("debugger.lldb Tests", () => {
    suite("getLLDBLibPath Tests", () => {
        let mockToolchain: MockedObject<SwiftToolchain>;
        let mockFindLibLLDB: MockedFunction<(typeof lldb)["findLibLLDB"]>;
        const mockedPlatform = mockGlobalValue(process, "platform");
        const mockUtil = mockGlobalModule(util);

        setup(() => {
            mockFindLibLLDB = sinon.stub();
            mockToolchain = mockObject<SwiftToolchain>({
                getLLDB: mockFn(),
                swiftFolderPath: "",
            });
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

        test("should return failure if findLibLLDB returns falsy values", async () => {
            mockToolchain.getLLDB.resolves("/path/to/lldb");
            mockUtil.execFile.resolves({ stdout: "", stderr: "" });
            mockFindLibLLDB.onFirstCall().resolves(undefined);

            let result = await lldb.getLLDBLibPath(instance(mockToolchain));
            expect(result.failure).to.not.equal(undefined);

            mockFindLibLLDB.onSecondCall().resolves("");

            result = await lldb.getLLDBLibPath(instance(mockToolchain));
            expect(result.failure).to.not.equal(undefined);
        });
        // NB(separate itest): contract test with toolchains of various platforms
    });

    suite("findLibLLDB Tests", () => {
        const fsMock = mockGlobalModule(fs);

        test("should return undefined if no file matches the pattern", async () => {
            fsMock.readdir.resolves(["file1", "file2"] as any);
            fsMock.stat.resolves({ isFile: () => false } as any);

            const result = await lldb.findLibLLDB("/path/hint");

            expect(result).to.be.undefined;
        });

        test("should return path if file exists", async () => {
            fsMock.stat.resolves({ isFile: () => true } as any);

            const result = await lldb.findLibLLDB("/path/hint");

            expect(result).to.equal("/path/hint");
        });
        // NB(separate itest): contract test with toolchains of various platforms
    });

    suite("findFileByPattern Tests", () => {
        const fsMock = mockGlobalModule(fs);

        test("should return null if no file matches the pattern", async () => {
            fsMock.readdir.resolves(["file1", "file2"] as any);

            const result = await lldb.findFileByPattern("/some/path", /pattern/);

            expect(result).to.be.null;
        });

        test("should return the first match if one file matches the pattern", async () => {
            fsMock.readdir.resolves(["match1", "nomatch"] as any);

            const result = await lldb.findFileByPattern("/some/path", /match1/);

            expect(result).to.equal("match1");
        });

        test("should return the first match if multiple files match the pattern", async () => {
            fsMock.readdir.resolves(["match1", "match2"] as any);

            const result = await lldb.findFileByPattern("/some/path", /match/);

            expect(result).to.equal("match1");
        });

        test("should return null if directory reading fails", async () => {
            fsMock.readdir.rejects(new Error("Some error"));

            const result = await lldb.findFileByPattern("/some/path", /pattern/);

            expect(result).to.be.null;
        });
    });
});
