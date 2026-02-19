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

import { WorkspaceContext } from "@src/WorkspaceContext";
import { getLLDBLibPath } from "@src/debugger/lldb";

import { activateExtensionForTest } from "../utilities/testutilities";

suite("lldb contract test suite", () => {
    let workspaceContext: WorkspaceContext;

    activateExtensionForTest({
        async setup(ctx) {
            workspaceContext = ctx;
        },
        requiresDebugger: true,
    });

    test("getLLDBLibPath Contract Test, make sure we can find lib LLDB", async () => {
        const libPath = await getLLDBLibPath(
            workspaceContext.globalToolchain,
            workspaceContext.logger
        );

        // Check the result for various platforms
        if (process.platform === "linux") {
            expect(libPath.success).to.match(/liblldb.*\.so.*/); // Matches .so file pattern
        } else if (process.platform === "darwin") {
            expect(libPath.success).to.match(/liblldb\..*dylib|LLDB/); // Matches .dylib or LLDB
        } else if (process.platform === "win32") {
            expect(libPath.success).to.match(/liblldb\.dll/); // Matches .dll for Windows
        } else {
            // In other platforms, the path hint should be returned directly
            expect(libPath.success).to.be.a("string");
        }
    });
});
