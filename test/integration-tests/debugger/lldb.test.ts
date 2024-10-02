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
import { getLLDBLibPath, getLldbProcess } from "../../../src/debugger/lldb";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";

suite("lldb contract test suite", () => {
    test("getLldbProcess Contract Test, make sure the command returns", async () => {
        const toolchain = await SwiftToolchain.create();
        const workspaceContext = await WorkspaceContext.create(
            new SwiftOutputChannel("Swift"),
            toolchain
        );
        const result = await getLldbProcess(workspaceContext);
        // Assumption: machine will always return some process
        expect(result).to.be.an("array");

        if (result) {
            // If result is an array, assert that each element has a pid and label
            result.forEach(item => {
                expect(item).to.have.property("pid").that.is.a("number");
                expect(item).to.have.property("label").that.is.a("string");
            });
        }
    });

    test("getLLDBLibPath Contract Test, make sure we can find lib LLDB", async () => {
        const toolchain = await SwiftToolchain.create();
        const libPath = await getLLDBLibPath(toolchain);

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
