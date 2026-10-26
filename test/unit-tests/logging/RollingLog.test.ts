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

import { RollingLog } from "@src/logging/RollingLog";

suite("RollingLog Unit Test Suite", () => {
    test("appends multiple lines up to capacity", () => {
        const log = new RollingLog(3);
        log.appendLine("a");
        log.appendLine("b");
        log.appendLine("c");
        expect(log.logs).to.deep.equal(["a", "b", "c"]);
    });

    test("drops oldest entries when exceeding capacity", () => {
        const log = new RollingLog(3);
        log.appendLine("a");
        log.appendLine("b");
        log.appendLine("c");
        log.appendLine("d");
        expect(log.logs).to.deep.equal(["b", "c", "d"]);
    });

    test("continues to roll correctly with many overflows", () => {
        const log = new RollingLog(3);
        log.appendLine("a");
        log.appendLine("b");
        log.appendLine("c");
        log.appendLine("d");
        log.appendLine("e");
        log.appendLine("f");
        log.appendLine("g");
        expect(log.logs).to.deep.equal(["e", "f", "g"]);
    });

    test("clear resets the log", () => {
        const log = new RollingLog(3);
        log.appendLine("a");
        log.appendLine("b");
        log.appendLine("c");
        log.clear();
        log.appendLine("d");
        expect(log.logs).to.deep.equal(["d"]);
    });

    test("clear resets the log even after overflow", () => {
        const log = new RollingLog(2);
        log.appendLine("a");
        log.appendLine("b");
        log.appendLine("c");
        log.appendLine("d");
        log.clear();
        log.appendLine("e");
        expect(log.logs).to.deep.equal(["e"]);
    });

    test("does not allow external modification of the logs array", () => {
        const log = new RollingLog(3);
        log.appendLine("a");
        log.logs.push("b", "c", "d", "e");
        expect(log.logs).to.deep.equal(["a"]);
    });

    suite("Keeping the first lines", () => {
        function appendLines(log: RollingLog, lines: string[]) {
            lines.forEach(line => log.appendLine(line));
        }

        test("Keeps the first lines along with the last lines", () => {
            const log = new RollingLog(2, 2);
            appendLines(log, ["a", "b", "c", "d", "e", "f"]);
            expect(log.logs.slice(0, 2)).to.deep.equal(["a", "b"]);
            expect(log.logs.slice(-2)).to.deep.equal(["e", "f"]);
        });

        test("Says how many lines were dropped between them", () => {
            const log = new RollingLog(2, 2);
            appendLines(log, ["a", "b", "c", "d", "e", "f", "g"]);
            expect(log.logs).to.have.lengthOf(5);
            expect(log.logs[2]).to.match(/\b3\b/);
        });

        test("Adds nothing until a line is dropped", () => {
            const log = new RollingLog(2, 2);
            appendLines(log, ["a", "b", "c", "d"]);
            expect(log.logs).to.deep.equal(["a", "b", "c", "d"]);
        });

        test("Clear forgets the first lines", () => {
            const log = new RollingLog(2, 2);
            appendLines(log, ["a", "b", "c", "d", "e"]);
            log.clear();
            log.appendLine("x");
            expect(log.logs).to.deep.equal(["x"]);
        });
    });
});
