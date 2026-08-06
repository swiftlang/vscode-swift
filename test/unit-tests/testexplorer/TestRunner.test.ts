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

import { debugSessionMatchesConfig } from "@src/TestExplorer/TestRunner";

suite("TestRunner Unit Test Suite", () => {
    suite("debugSessionMatchesConfig()", () => {
        const config = {
            type: "swift",
            request: "launch",
            name: "Swift Testing: Test MyPackage",
        } as vscode.DebugConfiguration;

        test("Matches when the session name equals the config name", () => {
            expect(
                debugSessionMatchesConfig(config, undefined, {
                    id: "session-1",
                    name: "Swift Testing: Test MyPackage",
                })
            ).to.be.true;
        });

        test("Does not match when neither the id nor the name match", () => {
            expect(
                debugSessionMatchesConfig(config, "session-1", {
                    id: "session-2",
                    name: "Some Other Session",
                })
            ).to.be.false;
        });

        test("Matches on the started session id even when the name differs", () => {
            expect(
                debugSessionMatchesConfig(config, "session-1", {
                    id: "session-1",
                    name: "lldb-dap",
                })
            ).to.be.true;
        });

        test("Falls back to the name when no started session id is known", () => {
            expect(
                debugSessionMatchesConfig(config, undefined, {
                    id: "session-1",
                    name: "Swift Testing: Test MyPackage",
                })
            ).to.be.true;
        });
    });
});
