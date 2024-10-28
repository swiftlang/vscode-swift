//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import { parseTestsFromSwiftTestListOutput } from "../../../src/TestExplorer/SPMTestDiscovery";
import { TestClass } from "../../../src/TestExplorer/TestDiscovery";

suite("SPMTestListOutputParser Suite", () => {
    const basicXCTest: TestClass = {
        id: "",
        label: "",
        disabled: false,
        style: "XCTest",
        location: undefined,
        children: [],
        tags: [{ id: "XCTest" }],
    };

    const basicSwiftTestingTest: TestClass = {
        ...basicXCTest,
        style: "swift-testing",
        tags: [{ id: "swift-testing" }],
    };

    test("Parse single XCTest", async () => {
        const tests = parseTestsFromSwiftTestListOutput("TestTarget.XCTestSuite/testXCTest");
        assert.deepEqual(tests, [
            {
                ...basicXCTest,
                id: "TestTarget",
                label: "TestTarget",
                tags: [{ id: "test-target" }],
                children: [
                    {
                        ...basicXCTest,
                        id: "TestTarget.XCTestSuite",
                        label: "XCTestSuite",
                        children: [
                            {
                                ...basicXCTest,
                                id: "TestTarget.XCTestSuite/testXCTest",
                                label: "testXCTest",
                            },
                        ],
                    },
                ],
            },
        ]);
    });

    test("Parse multiple XCTests", async () => {
        const tests = parseTestsFromSwiftTestListOutput(`
TestTarget.XCTestSuite/testXCTest
TestTarget.XCTestSuite/testAnotherXCTest
`);
        assert.deepEqual(tests, [
            {
                ...basicXCTest,
                id: "TestTarget",
                label: "TestTarget",
                tags: [{ id: "test-target" }],
                children: [
                    {
                        ...basicXCTest,
                        id: "TestTarget.XCTestSuite",
                        label: "XCTestSuite",
                        children: [
                            {
                                ...basicXCTest,
                                id: "TestTarget.XCTestSuite/testXCTest",
                                label: "testXCTest",
                            },
                            {
                                ...basicXCTest,
                                id: "TestTarget.XCTestSuite/testAnotherXCTest",
                                label: "testAnotherXCTest",
                            },
                        ],
                    },
                ],
            },
        ]);
    });

    test("Parse one of each style", async () => {
        const tests = parseTestsFromSwiftTestListOutput(`
TestTarget.XCTestSuite/testXCTest
TestTarget.testSwiftTest()
`);
        assert.deepEqual(tests, [
            {
                ...basicXCTest,
                id: "TestTarget",
                label: "TestTarget",
                tags: [{ id: "test-target" }],
                children: [
                    {
                        ...basicXCTest,
                        id: "TestTarget.XCTestSuite",
                        label: "XCTestSuite",
                        children: [
                            {
                                ...basicXCTest,
                                id: "TestTarget.XCTestSuite/testXCTest",
                                label: "testXCTest",
                            },
                        ],
                    },
                    {
                        ...basicSwiftTestingTest,
                        id: "TestTarget.testSwiftTest()",
                        label: "testSwiftTest()",
                    },
                ],
            },
        ]);
    });

    test("Parse single top level swift testing test", async () => {
        const tests = parseTestsFromSwiftTestListOutput("TestTarget.testSwiftTest()");
        assert.deepEqual(tests, [
            {
                ...basicSwiftTestingTest,
                id: "TestTarget",
                label: "TestTarget",
                tags: [{ id: "test-target" }],
                children: [
                    {
                        ...basicSwiftTestingTest,
                        id: "TestTarget.testSwiftTest()",
                        label: "testSwiftTest()",
                    },
                ],
            },
        ]);
    });

    test("Parse multiple top level swift testing tests", async () => {
        const tests = parseTestsFromSwiftTestListOutput(`
TestTarget.testSwiftTest()
TestTarget.testAnotherSwiftTest()
`);
        assert.deepEqual(tests, [
            {
                ...basicSwiftTestingTest,
                id: "TestTarget",
                label: "TestTarget",
                tags: [{ id: "test-target" }],
                children: [
                    {
                        ...basicSwiftTestingTest,
                        id: "TestTarget.testSwiftTest()",
                        label: "testSwiftTest()",
                    },
                    {
                        ...basicSwiftTestingTest,
                        id: "TestTarget.testAnotherSwiftTest()",
                        label: "testAnotherSwiftTest()",
                    },
                ],
            },
        ]);
    });

    test("Parse nested swift testing tests", async () => {
        const tests = parseTestsFromSwiftTestListOutput(`
TestTarget.RootSuite/NestedSuite/nestedTestInASuite()
TestTarget.RootSuite/aTestInASuite()
`);
        assert.deepEqual(tests, [
            {
                ...basicSwiftTestingTest,
                id: "TestTarget",
                label: "TestTarget",
                tags: [{ id: "test-target" }],
                children: [
                    {
                        ...basicSwiftTestingTest,
                        id: "TestTarget.RootSuite",
                        label: "RootSuite",
                        children: [
                            {
                                ...basicSwiftTestingTest,
                                id: "TestTarget.RootSuite/NestedSuite",
                                label: "NestedSuite",
                                children: [
                                    {
                                        ...basicSwiftTestingTest,
                                        id: "TestTarget.RootSuite/NestedSuite/nestedTestInASuite()",
                                        label: "nestedTestInASuite()",
                                    },
                                ],
                            },
                            {
                                ...basicSwiftTestingTest,
                                id: "TestTarget.RootSuite/aTestInASuite()",
                                label: "aTestInASuite()",
                            },
                        ],
                    },
                ],
            },
        ]);
    });
});
