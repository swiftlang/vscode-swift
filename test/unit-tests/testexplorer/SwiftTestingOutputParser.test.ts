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
import { beforeEach } from "mocha";

import { SwiftTestingOutputParser } from "@src/TestExplorer/TestParsers/SwiftTestingOutputParser";
import { ITestRunState } from "@src/TestExplorer/TestParsers/TestRunState";

import { MockedObject, instance, mockFn, mockObject } from "../../MockUtils";

suite("SwiftTestingOutputParser Unit Test Suite", () => {
    suite("parseStdout()", () => {
        let runState: MockedObject<ITestRunState>;
        let parser: SwiftTestingOutputParser;

        beforeEach(() => {
            runState = mockObject<ITestRunState>({
                recordOutput: mockFn(),
            });
            parser = new SwiftTestingOutputParser(
                () => {},
                () => {}
            );
        });

        test("Records a chunk containing many lines as a single output entry", () => {
            const chunk = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");

            parser.parseStdout(chunk, instance(runState));

            expect(runState.recordOutput).to.have.callCount(1);
        });

        test("Preserves every line of the chunk, terminated with CRLF", () => {
            parser.parseStdout("first\nsecond\nthird", instance(runState));

            expect(runState.recordOutput).to.have.been.calledOnceWithExactly(
                undefined,
                "first\r\nsecond\r\nthird\r\n"
            );
        });

        test("Normalizes CR and CRLF line endings to CRLF", () => {
            parser.parseStdout("first\r\nsecond\rthird\n", instance(runState));

            expect(runState.recordOutput).to.have.been.calledOnceWithExactly(
                undefined,
                "first\r\nsecond\r\nthird\r\n"
            );
        });

        test("Drops blank and whitespace-only lines", () => {
            parser.parseStdout("first\n\n   \nsecond\n", instance(runState));

            expect(runState.recordOutput).to.have.been.calledOnceWithExactly(
                undefined,
                "first\r\nsecond\r\n"
            );
        });

        test("Records nothing for a chunk with no printable content", () => {
            parser.parseStdout("\n  \n\n", instance(runState));

            expect(runState.recordOutput).to.not.have.been.called;
        });

        test("Records output against the run rather than an individual test", () => {
            parser.parseStdout("some output\n", instance(runState));

            expect(runState.recordOutput.firstCall.args[0]).to.be.undefined;
        });
    });
});
