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
import { getLldbProcess } from "../../../src/debugger/lldb";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";

suite("getLldbProcess Contract Test Suite", () => {
    test("happy path, make sure lldb call returns proper output", async () => {
        const toolchain = await SwiftToolchain.create();
        const workspaceContext = await WorkspaceContext.create(
            new SwiftOutputChannel("Swift"),
            toolchain
        );
        assert.notStrictEqual(await getLldbProcess(workspaceContext), []);
    });
});
