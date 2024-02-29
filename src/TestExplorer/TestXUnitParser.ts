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

interface XUnitFailure {
    message?: string;
}

interface XUnitTestCase {
    $: { classname: string; name: string; time: number };
    failure?: XUnitFailure[];
}

interface XUnitTestSuite {
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

    async parse(buffer: string, runState: iXUnitTestState) {
        const xml = await xml2js.parseStringPromise(buffer);
        try {
            this.parseXUnit(xml, runState);
        } catch (error) {
            // ignore error
            console.log(error);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async parseXUnit(xUnit: XUnit, runState: iXUnitTestState) {
        xUnit.testsuites.testsuite.forEach(testsuite => {
            testsuite.testcase.forEach(testcase => {
                const id = `${testcase.$.classname}/${testcase.$.name}`;
                if (testcase.failure) {
                    runState.failTest(id, testcase.$.time, testcase.failure.shift()?.message);
                } else {
                    runState.passTest(id, testcase.$.time);
                }
            });
        });
    }
}
