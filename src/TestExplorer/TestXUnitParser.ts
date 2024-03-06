//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as xml2js from "xml2js";

export interface iXUnitTestState {
    passTest(id: string, duration: number): void;
    failTest(id: string, duration: number, message?: string): void;
    skipTest(id: string): void;
}

export interface TestResults {
    tests: number;
    failures: number;
    errors: number;
}

interface XUnitFailure {
    message?: string;
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
    constructor() {}

    async parse(buffer: string, runState: iXUnitTestState): Promise<TestResults | undefined> {
        const xml = await xml2js.parseStringPromise(buffer);
        try {
            return await this.parseXUnit(xml, runState);
        } catch (error) {
            // ignore error
            console.log(error);
            return undefined;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async parseXUnit(xUnit: XUnit, runState: iXUnitTestState): Promise<TestResults> {
        let tests = 0;
        let failures = 0;
        let errors = 0;
        xUnit.testsuites.testsuite.forEach(testsuite => {
            tests = tests + parseInt(testsuite.$.tests);
            failures += parseInt(testsuite.$.failures);
            errors += parseInt(testsuite.$.errors);
            testsuite.testcase.forEach(testcase => {
                const id = `${testcase.$.classname}/${testcase.$.name}`;
                if (testcase.failure) {
                    runState.failTest(id, testcase.$.time, testcase.failure.shift()?.message);
                } else {
                    runState.passTest(id, testcase.$.time);
                }
            });
        });
        return { tests: tests, failures: failures, errors: errors };
    }
}
