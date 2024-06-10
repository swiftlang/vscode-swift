//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as assert from "assert";
import { beforeEach } from "mocha";
import { TestRunArguments } from "../../../src/TestExplorer/TestRunArguments";

suite("TestRunArguments Suite", () => {
    let controller: vscode.TestController;
    let testTarget: vscode.TestItem;
    let xcSuite: vscode.TestItem;
    let xcTest: vscode.TestItem;
    let swiftTestSuite: vscode.TestItem;
    let swiftTest: vscode.TestItem;

    beforeEach(function () {
        controller = vscode.tests.createTestController(
            this.currentTest?.id ?? "TestRunArgumentsTests",
            ""
        );

        testTarget = controller.createTestItem("TestTarget", "TestTarget");
        testTarget.tags = [{ id: "test-target" }];

        controller.items.add(testTarget);

        xcSuite = controller.createTestItem(
            "XCTest Suite",
            "XCTest Suite",
            vscode.Uri.file("/path/to/file")
        );
        xcSuite.tags = [{ id: "XCTest" }];

        testTarget.children.add(xcSuite);

        xcTest = controller.createTestItem(
            "XCTest Item",
            "XCTest Item",
            vscode.Uri.file("/path/to/file")
        );
        xcTest.tags = [{ id: "XCTest" }];

        xcSuite.children.add(xcTest);

        swiftTestSuite = controller.createTestItem(
            "Swift Test Suite",
            "Swift Test Suite",
            vscode.Uri.file("/path/to/file")
        );
        swiftTestSuite.tags = [{ id: "swift-testing" }];

        testTarget.children.add(swiftTestSuite);

        swiftTest = controller.createTestItem(
            "Swift Test Item",
            "Swift Test Item",
            vscode.Uri.file("/path/to/file")
        );
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
        assert.deepEqual(testArgs.xcTestArgs, [xcSuite.id]);
        assert.deepEqual(testArgs.swiftTestArgs, [swiftTestSuite.id]);
        assert.deepEqual(
            testArgs.testItems.map(item => item.id),
            [testTarget.id, xcSuite.id, xcTest.id, swiftTestSuite.id, swiftTest.id]
        );
    });

    test("Exclude Suite", () => {
        const testArgs = new TestRunArguments(
            new vscode.TestRunRequest([xcSuite, swiftTestSuite], [xcSuite], undefined)
        );
        assert.equal(testArgs.hasXCTests, false);
        assert.equal(testArgs.hasSwiftTestingTests, true);
        assert.deepEqual(testArgs.xcTestArgs, []);
        assert.deepEqual(testArgs.swiftTestArgs, [swiftTestSuite.id]);
        assert.deepEqual(
            testArgs.testItems.map(item => item.id),
            [testTarget.id, swiftTestSuite.id, swiftTest.id]
        );
    });

    test("Exclude Test", () => {
        const testArgs = new TestRunArguments(
            new vscode.TestRunRequest([xcSuite, swiftTestSuite], [xcTest], undefined)
        );
        assert.equal(testArgs.hasXCTests, false);
        assert.equal(testArgs.hasSwiftTestingTests, true);
        assert.deepEqual(testArgs.xcTestArgs, []);
        assert.deepEqual(testArgs.swiftTestArgs, [swiftTestSuite.id]);
        assert.deepEqual(
            testArgs.testItems.map(item => item.id),
            [testTarget.id, swiftTestSuite.id, swiftTest.id]
        );
    });

    test("Single Test in Suite With Multiple", () => {
        const anotherSwiftTest = controller.createTestItem(
            "Another Swift Test Item",
            "Another Swift Test Item",
            vscode.Uri.file("/path/to/file")
        );
        anotherSwiftTest.tags = [{ id: "swift-testing" }];
        swiftTestSuite.children.add(anotherSwiftTest);

        const testArgs = new TestRunArguments(
            new vscode.TestRunRequest([anotherSwiftTest], [], undefined)
        );
        assert.equal(testArgs.hasXCTests, false);
        assert.equal(testArgs.hasSwiftTestingTests, true);
        assert.deepEqual(testArgs.xcTestArgs, []);
        assert.deepEqual(testArgs.swiftTestArgs, [anotherSwiftTest.id]);
        assert.deepEqual(
            testArgs.testItems.map(item => item.id),
            [swiftTestSuite.id, testTarget.id, anotherSwiftTest.id]
        );
    });
});
