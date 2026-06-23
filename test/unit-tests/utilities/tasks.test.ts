//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";
import * as vscode from "vscode";

import { findTaskTerminal } from "@src/utilities/tasks";

import { instance, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";

suite("Task utilities", () => {
    suite("findTaskTerminal", () => {
        const windowMock = mockGlobalObject(vscode, "window");

        function swiftTask(name: string): vscode.Task {
            return new vscode.Task({ type: "swift" }, vscode.TaskScope.Global, name, "swift");
        }

        function terminal(name: string): vscode.Terminal {
            return instance(mockObject<vscode.Terminal>({ name, show: mockFn() }));
        }

        test("matches a terminal whose name equals the task name", () => {
            const buildTerminal = terminal("Build All");
            windowMock.terminals = [terminal("Run"), buildTerminal];

            expect(findTaskTerminal(swiftTask("Build All"))).to.equal(buildTerminal);
        });

        test("matches a terminal whose name is the source-prefixed task name", () => {
            const buildTerminal = terminal("swift: Build All");
            windowMock.terminals = [terminal("swift: Run"), buildTerminal];

            expect(findTaskTerminal(swiftTask("Build All"))).to.equal(buildTerminal);
        });

        test("returns undefined when no terminal matches", () => {
            windowMock.terminals = [terminal("Unrelated terminal")];

            expect(findTaskTerminal(swiftTask("Build All"))).to.be.undefined;
        });

        test("does not match a terminal with a non-swift source prefix", () => {
            windowMock.terminals = [terminal("other: Build All")];

            expect(findTaskTerminal(swiftTask("Build All"))).to.be.undefined;
        });
    });
});
