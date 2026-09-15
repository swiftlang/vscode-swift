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

import {
    SwiftTestingPreamble,
    TEST_RUN_STARTED_MARKER,
    debugSessionMatchesConfig,
} from "@src/TestExplorer/TestRunner";

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

    suite("SwiftTestingPreamble", () => {
        const ESC = String.fromCharCode(27);
        const buildOutput = "Building for debugging...\nBuild complete! (0.17s)\n";

        test("No run start during the build", () => {
            const preamble = new SwiftTestingPreamble();

            expect(preamble.hasRunStarted(buildOutput)).to.be.false;
        });

        test("Finds the run start", () => {
            const preamble = new SwiftTestingPreamble();
            preamble.hasRunStarted(buildOutput);

            expect(preamble.hasRunStarted(`◇ ${TEST_RUN_STARTED_MARKER}\n`)).to.be.true;
        });

        test("Finds a colourised run start", () => {
            const preamble = new SwiftTestingPreamble();
            const [head, tail] = TEST_RUN_STARTED_MARKER.split(" run ");

            expect(preamble.hasRunStarted(`◇ ${head}${ESC}[1m run ${tail}${ESC}[0m\n`)).to.be.true;
        });

        test("Finds a run start split across chunks", () => {
            const preamble = new SwiftTestingPreamble();
            const split = TEST_RUN_STARTED_MARKER.length - 4;

            expect(preamble.hasRunStarted(`◇ ${TEST_RUN_STARTED_MARKER.slice(0, split)}`)).to.be
                .false;
            expect(preamble.hasRunStarted(`${TEST_RUN_STARTED_MARKER.slice(split)}\n`)).to.be.true;
        });

        test("Run stays started", () => {
            const preamble = new SwiftTestingPreamble();
            preamble.hasRunStarted(`◇ ${TEST_RUN_STARTED_MARKER}\n`);

            expect(preamble.hasRunStarted("A print statement in a test.\n")).to.be.true;
        });
    });
});
