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
import * as mockFS from "mock-fs";
import * as sinon from "sinon";

import * as lldb from "@src/debugger/lldb";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as util from "@src/utilities/utilities";

import {
    MockedFunction,
    MockedObject,
    instance,
    mockFn,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";

suite("debugger.lldb Tests", () => {
    suite("getLLDBLibPath()", () => {
        let mockToolchain: MockedObject<SwiftToolchain>;
        let execFileStub: MockedFunction<typeof util.execFile>;
        const mockedPlatform = mockGlobalValue(process, "platform");

        setup(() => {
            mockFS();
            execFileStub = sinon.stub(util, "execFile");
            mockToolchain = mockObject<SwiftToolchain>({
                swiftFolderPath: "/usr/bin",
                toolchainPath: "/toolchain",
                getLLDB: mockFn(s => s.resolves("/toolchain/bin/lldb")),
            });
        });

        teardown(() => {
            mockFS.restore();
            sinon.restore();
        });

        suite("macOS", () => {
            setup(() => {
                mockedPlatform.setValue("darwin");
            });

            test("returns the path to the LLDB dynamic library found by querying LLDB", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        Libraries: {
                            "liblldb.dylib": mockFS.file({ mode: 0o777, content: "" }),
                        },
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").resolves({
                    stdout: "<!/toolchain/Libraries!>\n",
                    stderr: "",
                });

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/Libraries/liblldb.dylib");
                expect(result.failure).to.be.undefined;
            });

            test("falls back to searching the toolchain path if querying LLDB returns nothing", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        "liblldb.dylib": mockFS.file({ mode: 0o777, content: "" }),
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").resolves({
                    stdout: "",
                    stderr: "",
                });

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/liblldb.dylib");
                expect(result.failure).to.be.undefined;
            });

            test("falls back to searching the toolchain path if querying LLDB fails", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        "liblldb.dylib": mockFS.file({ mode: 0o777, content: "" }),
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").rejects(Error("Something went wrong"));

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/liblldb.dylib");
                expect(result.failure).to.be.undefined;
            });
        });

        suite("Linux", () => {
            setup(() => {
                mockedPlatform.setValue("linux");
            });

            test("returns the path to the LLDB dynamic library found by querying LLDB", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        Libraries: {
                            "liblldb.so": mockFS.file({ mode: 0o777, content: "" }),
                        },
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").resolves({
                    stdout: "<!/toolchain/Libraries!>\n",
                    stderr: "",
                });

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/Libraries/liblldb.so");
                expect(result.failure).to.be.undefined;
            });

            test("falls back to searching the toolchain path if querying LLDB returns nothing", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        "liblldb.so": mockFS.file({ mode: 0o777, content: "" }),
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").resolves({
                    stdout: "",
                    stderr: "",
                });

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/liblldb.so");
                expect(result.failure).to.be.undefined;
            });

            test("falls back to searching the toolchain path if querying LLDB fails", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        "liblldb.so": mockFS.file({ mode: 0o777, content: "" }),
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").rejects(Error("Something went wrong"));

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/liblldb.so");
                expect(result.failure).to.be.undefined;
            });
        });

        suite("Windows", () => {
            setup(() => {
                mockedPlatform.setValue("win32");
            });

            test("returns the path to the LLDB dynamic library found by querying LLDB", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        Libraries: {
                            "liblldb.dll": mockFS.file({ mode: 0o777, content: "" }),
                        },
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").resolves({
                    stdout: "<!/toolchain/Libraries!>\n",
                    stderr: "",
                });

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/Libraries/liblldb.dll");
                expect(result.failure).to.be.undefined;
            });

            test("falls back to searching the toolchain path if querying LLDB returns nothing", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        "liblldb.dll": mockFS.file({ mode: 0o777, content: "" }),
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").resolves({
                    stdout: "",
                    stderr: "",
                });

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.equalPath("/toolchain/liblldb.dll");
                expect(result.failure).to.be.undefined;
            });

            test("fails with an undefined error if querying LLDB fails", async () => {
                mockFS({
                    "/toolchain": {
                        bin: {
                            lldb: mockFS.file({ mode: 0o777, content: "" }),
                        },
                        "liblldb.so": mockFS.file({ mode: 0o777, content: "" }),
                    },
                });
                execFileStub.withArgs("/toolchain/bin/lldb").rejects(Error("Something went wrong"));

                const result = await lldb.getLLDBLibPath(instance(mockToolchain));
                expect(result.success).to.be.undefined;
                expect(result.failure).to.be.undefined;
            });
        });
    });
});
