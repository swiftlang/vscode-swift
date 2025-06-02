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
import * as vscode from "vscode";
import { TestSwiftProcess } from "../../fixtures";
import { waitForClose, waitForWrite } from "../../utilities/tasks";
import { SwiftPseudoterminal } from "../../../src/tasks/SwiftPseudoterminal";

suite("SwiftPseudoterminal Tests Suite", () => {
    test("Close event handler fires", async () => {
        const process = new TestSwiftProcess("swift", ["build"]);
        const terminal = new SwiftPseudoterminal(() => process, {});

        terminal.open(undefined);
        const promise = waitForClose(terminal);
        process.close(1);

        const exitCode = await promise;
        assert.equal(exitCode, 1);
    });

    test("Write event handler fires", async () => {
        const process = new TestSwiftProcess("swift", ["build"]);
        const terminal = new SwiftPseudoterminal(() => process, {});

        terminal.open(undefined);
        const promise = waitForWrite(terminal);
        process.write("Fetching some dependency");

        const output = await promise;
        // Uses expected terminal line ending
        assert.equal(output, "Fetching some dependency\n\r");
    });

    test("Echoes the command", async () => {
        const process = new TestSwiftProcess("swift", ["build", "-c", "dbg"]);
        const terminal = new SwiftPseudoterminal(() => process, { echo: true });
        const promise = waitForWrite(terminal);

        terminal.open(undefined);

        const output = await promise;
        assert.equal(output, "> swift build -c dbg\n\n\r");
    });

    test("Does not echo the command", async () => {
        const process = new TestSwiftProcess("swift", ["build", "-c", "dbg"]);
        const terminal = new SwiftPseudoterminal(() => process, { echo: false });
        let wrote = false;
        const disposable = terminal.onDidWrite(() => {
            wrote = true;
        });

        terminal.open(undefined);
        disposable.dispose();

        assert.equal(wrote, false);
    });

    test("Handles error on spawn", async () => {
        const process = new TestSwiftProcess("swift", ["build", "-c", "dbg"]);
        const terminal = new SwiftPseudoterminal(() => process, { echo: false });
        process.setError(new Error("Uh oh!"));

        const promise = waitForClose(terminal);
        terminal.open(undefined);

        const exitCode = await promise;
        // Abrupt termination
        assert.equal(exitCode, undefined);
    });

    test("Handles ctrl+c", async () => {
        const process = new (class extends TestSwiftProcess {
            input?: string;

            handleInput(input: string): void {
                this.input = input;
            }
        })("swift", ["build", "-c", "dbg"]);
        const terminal = new SwiftPseudoterminal(() => process, { echo: false });
        const promise = waitForClose(terminal);

        terminal.open(undefined);
        terminal.handleInput(Buffer.of(3).toString());

        const exitCode = await promise;
        assert.equal(exitCode, 8);
        assert.equal(process.input, undefined);
    });

    test("Propagates all other input", async () => {
        const process = new (class extends TestSwiftProcess {
            input?: string;

            handleInput(input: string): void {
                this.input = input;
            }
        })("swift", ["build", "-c", "dbg"]);
        const terminal = new SwiftPseudoterminal(() => process, { echo: false });
        terminal.open(undefined);

        terminal.handleInput("foo");

        assert.equal(process.input, "foo");
    });

    test("Sets initial pty dimensions", async () => {
        const process = new (class extends TestSwiftProcess {
            dimensions?: vscode.TerminalDimensions;

            setDimensions(dimensions: vscode.TerminalDimensions): void {
                this.dimensions = dimensions;
            }
        })("swift", ["build", "-c", "dbg"]);
        const terminal = new SwiftPseudoterminal(() => process, { echo: false });

        terminal.open({ rows: 100, columns: 200 });

        assert.deepEqual(process.dimensions, { rows: 100, columns: 200 });
    });

    test("Update pty dimensions", async () => {
        const process = new (class extends TestSwiftProcess {
            dimensions?: vscode.TerminalDimensions;

            setDimensions(dimensions: vscode.TerminalDimensions): void {
                this.dimensions = dimensions;
            }
        })("swift", ["build", "-c", "dbg"]);
        const terminal = new SwiftPseudoterminal(() => process, { echo: false });

        terminal.open({ rows: 100, columns: 200 });

        assert.deepEqual(process.dimensions, { rows: 100, columns: 200 });

        terminal.setDimensions({ rows: 200, columns: 400 });

        assert.deepEqual(process.dimensions, { rows: 200, columns: 400 });
    });
});
