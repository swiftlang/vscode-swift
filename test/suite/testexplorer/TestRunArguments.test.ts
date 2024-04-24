//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as assert from "assert";
import { beforeEach } from "mocha";
import { TestRunArguments } from "../../../src/TestExplorer/TestRunner";

suite("TestRunArguments Suite", () => {
    let controller: vscode.TestController;
    let xcSuite: vscode.TestItem;
    let xcTest: vscode.TestItem;
    let swiftTestSuite: vscode.TestItem;
    let swiftTest: vscode.TestItem;

    beforeEach(function () {
        controller = vscode.tests.createTestController(
            this.currentTest?.id ?? "TestRunArgumentsTests",
            ""
        );
        xcSuite = controller.createTestItem("XCTest Suite", "XCTest Suite");
        xcSuite.tags = [{ id: "XCTest" }];

        xcTest = controller.createTestItem("XCTest Item", "XCTest Item");
        xcTest.tags = [{ id: "XCTest" }];

        xcSuite.children.add(xcTest);

        swiftTestSuite = controller.createTestItem("Swift Test Suite", "Swift Test Suite");
        swiftTestSuite.tags = [{ id: "swift-testing" }];

        swiftTest = controller.createTestItem("Swift Test Item", "Swift Test Item");
        swiftTest.tags = [{ id: "swift-testing" }];

        swiftTestSuite.children.add(swiftTest);
    });

    test("Empty Request", () => {
        const testArgs = new TestRunArguments(new vscode.TestRunRequest([], undefined, undefined));
        assert.equal(testArgs.hasXCTests, false);
        assert.equal(testArgs.hasSwiftTestingTests, false);
    });

    test("Both Suites Included", () => {
        const testArgs = new TestRunArguments(
            new vscode.TestRunRequest([xcSuite, swiftTestSuite], undefined, undefined)
        );
        assert.equal(testArgs.hasXCTests, true);
        assert.equal(testArgs.hasSwiftTestingTests, true);
        assert.deepEqual(testArgs.xcTestArgs, [xcTest.id]);
        assert.deepEqual(testArgs.swiftTestArgs, [swiftTest.id]);
        assert.deepEqual(
            testArgs.testItems.map(item => item.id),
            [xcSuite.id, xcTest.id, swiftTestSuite.id, swiftTest.id]
        );
    });

    test("Exclude Suite", () => {
        const testArgs = new TestRunArguments(
            new vscode.TestRunRequest([xcSuite, swiftTestSuite], [xcSuite], undefined)
        );
        assert.equal(testArgs.hasXCTests, false);
        assert.equal(testArgs.hasSwiftTestingTests, true);
        assert.deepEqual(testArgs.xcTestArgs, []);
        assert.deepEqual(testArgs.swiftTestArgs, [swiftTest.id]);
        assert.deepEqual(
            testArgs.testItems.map(item => item.id),
            [swiftTestSuite.id, swiftTest.id]
        );
    });

    test("Exclude Test", () => {
        const testArgs = new TestRunArguments(
            new vscode.TestRunRequest([xcSuite, swiftTestSuite], [xcTest], undefined)
        );
        assert.equal(testArgs.hasXCTests, false);
        assert.equal(testArgs.hasSwiftTestingTests, true);
        assert.deepEqual(testArgs.xcTestArgs, []);
        assert.deepEqual(testArgs.swiftTestArgs, [swiftTest.id]);
        assert.deepEqual(
            testArgs.testItems.map(item => item.id),
            [swiftTestSuite.id, swiftTest.id]
        );
    });
});
