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
import * as xml2js from "xml2js";

import { SwiftLogger } from "../logging/SwiftLogger";
import { ITestRunState } from "./TestParsers/TestRunState";

interface TestResults {
    tests: number;
    failures: number;
    errors: number;
}

interface XUnitFailure {
    $: { message?: string };
}

interface XUnitTestCase {
    $: { classname: string; name: string; time: number };
    failure?: XUnitFailure[];
}

interface XUnitTestSuite {
    $: { name: string; errors: string; failures: string; tests: string; time: string };
    testcase: XUnitTestCase[];
}

interface XUnitTestSuites {
    testsuite: XUnitTestSuite[];
}

interface XUnit {
    testsuites: XUnitTestSuites;
}

export class TestXUnitParser {
    constructor(private hasMultiLineParallelTestOutput: boolean) {}

    async parse(
        buffer: string,
        runState: ITestRunState,
        logger: SwiftLogger
    ): Promise<TestResults | undefined> {
        const xml = await xml2js.parseStringPromise(buffer);
        try {
            return await this.parseXUnit(xml, runState);
        } catch (error) {
            // ignore error
            logger.error(`Error parsing xUnit output: ${error}`);
            return undefined;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async parseXUnit(xUnit: XUnit, runState: ITestRunState): Promise<TestResults> {
        // eslint-disable-next-line no-console
        let tests = 0;
        let failures = 0;
        let errors = 0;
        xUnit.testsuites.testsuite.forEach(testsuite => {
            const suiteFailures = parseInt(testsuite.$.failures);
            failures += suiteFailures;
            tests = tests + parseInt(testsuite.$.tests);
            errors += parseInt(testsuite.$.errors);

            let className: string | undefined;
            testsuite.testcase.forEach(testcase => {
                className = testcase.$.classname;
                const id = `${className}/${testcase.$.name}`;
                const index = runState.getTestItemIndex(id, undefined);

                // From 5.7 to 5.10 running with the --parallel option dumps the test results out
                // to the console with no newlines, so it isn't possible to distinguish where errors
                // begin and end. Consequently we can't record them, and so we manually mark them
                // as passed or failed here with a manufactured issue.
                if (!!testcase.failure && !this.hasMultiLineParallelTestOutput) {
                    runState.recordIssue(
                        index,
                        testcase.failure.shift()?.$.message ?? "Test Failed",
                        false
                    );
                }
                runState.completed(index, { duration: testcase.$.time });
            });

            if (className !== undefined) {
                if (className && suiteFailures === 0) {
                    runState.passedSuite(className);
                } else if (className) {
                    runState.failedSuite(className);
                }
            }
        });
        return { tests: tests, failures: failures, errors: errors };
    }
}
