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
import { MockedObject, mockObject, instance, mockGlobalModule } from "../../MockUtils";
import configuration from "@src/configuration";
import { DebugAdapter, LaunchConfigType } from "@src/debugger/debugAdapter";
import { Version } from "@src/utilities/version";

suite("DebugAdapter Unit Test Suite", () => {
    const mockConfiguration = mockGlobalModule(configuration);

    let mockDebugConfig: MockedObject<(typeof configuration)["debugger"]>;

    setup(() => {
        // Mock VS Code settings
        mockDebugConfig = mockObject<(typeof configuration)["debugger"]>({
            debugAdapter: "auto",
            customDebugAdapterPath: "",
        });
        mockConfiguration.debugger = instance(mockDebugConfig);
        // Mock the file system
        mockFS({});
    });

    teardown(() => {
        mockFS.restore();
    });

    suite("getLaunchConfigType()", () => {
        test("returns LLDB_DAP when Swift version >=6.0.0 and swift.debugger.debugAdapter is set to lldb-dap", () => {
            mockDebugConfig.debugAdapter = "lldb-dap";
            expect(DebugAdapter.getLaunchConfigType(new Version(6, 0, 1))).to.equal(
                LaunchConfigType.LLDB_DAP
            );
        });

        test("returns LLDB_DAP when Swift version >=6.0.0 and swift.debugger.debugAdapter is set to auto", () => {
            mockDebugConfig.debugAdapter = "auto";
            expect(DebugAdapter.getLaunchConfigType(new Version(6, 0, 1))).to.equal(
                LaunchConfigType.LLDB_DAP
            );
        });

        test("returns CODE_LLDB when Swift version >=6.0.0 and swift.debugger.debugAdapter is set to CODE_LLDB", () => {
            mockDebugConfig.debugAdapter = "CodeLLDB";
            expect(DebugAdapter.getLaunchConfigType(new Version(6, 0, 1))).to.equal(
                LaunchConfigType.CODE_LLDB
            );
        });

        test("returns CODE_LLDB when Swift version is older than 6.0.0 regardless of setting", () => {
            // Try with the setting set to auto
            mockDebugConfig.debugAdapter = "auto";
            expect(DebugAdapter.getLaunchConfigType(new Version(5, 10, 0))).to.equal(
                LaunchConfigType.CODE_LLDB
            );
            // Try with the setting set to CodeLLDB
            mockDebugConfig.debugAdapter = "CodeLLDB";
            expect(DebugAdapter.getLaunchConfigType(new Version(5, 10, 0))).to.equal(
                LaunchConfigType.CODE_LLDB
            );
            // Try with the setting set to lldb-dap
            mockDebugConfig.debugAdapter = "lldb-dap";
            expect(DebugAdapter.getLaunchConfigType(new Version(5, 10, 0))).to.equal(
                LaunchConfigType.CODE_LLDB
            );
        });
    });
});
