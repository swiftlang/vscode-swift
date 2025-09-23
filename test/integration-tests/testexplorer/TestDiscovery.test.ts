//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as assert from "assert";
import { beforeEach } from "mocha";
import * as vscode from "vscode";

import { SwiftPackage, Target, TargetType } from "@src/SwiftPackage";
import {
    TestClass,
    updateTests,
    updateTestsForTarget,
    updateTestsFromClasses,
} from "@src/TestExplorer/TestDiscovery";
import { reduceTestItemChildren } from "@src/TestExplorer/TestUtils";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { TestStyle } from "@src/sourcekit-lsp/extensions";

import { activateExtensionForSuite } from "../utilities/testutilities";

suite("TestDiscovery Suite", () => {
    let workspaceContext: WorkspaceContext;
    let testController: vscode.TestController;
    let testRunCtr = 0;

    activateExtensionForSuite({
        setup(ctx) {
            workspaceContext = ctx;
        },
    });

    interface SimplifiedTestItem {
        id: string;
        children: SimplifiedTestItem[];
        tags: readonly { id: string }[];
    }

    function testControllerChildren(collection: vscode.TestItemCollection): SimplifiedTestItem[] {
        return reduceTestItemChildren(
            collection,
            (acc, item) => [
                ...acc,
                {
                    id: item.id,
                    tags: [...item.tags.map(tag => ({ id: tag.id }))],
                    children: testControllerChildren(item.children),
                },
            ],
            [] as SimplifiedTestItem[]
        );
    }

    function testItem(id: string, style: TestStyle = "XCTest"): TestClass {
        return {
            id,
            label: id,
            disabled: false,
            style,
            location: undefined,
            tags: [],
            children: [],
        };
    }

    beforeEach(() => {
        const id = `TestDiscovery Suite Test Controller ${testRunCtr}`;
        testController = vscode.tests.createTestController(id, id);
        testRunCtr += 1;
    });

    test("updates tests with empty collection", () => {
        updateTests(testController, []);
        assert.equal(testController.items.size, 0);
    });

    test("removes test item not included in the new list", () => {
        const foo = testController.createTestItem("foo", "foo");
        testController.items.add(foo);
        const bar = testController.createTestItem("bar", "bar");
        testController.items.add(bar);

        // `foo` is no longer in the list of new children
        updateTests(testController, [testItem("bar")]);

        assert.deepStrictEqual(testControllerChildren(testController.items), [
            { id: "bar", tags: [{ id: "XCTest" }, { id: "runnable" }], children: [] },
        ]);
    });

    test("removes parameterized test result children", () => {
        const fileUri = vscode.Uri.file("file:///some/file.swift");
        const parent = testController.createTestItem("parent", "parent", fileUri);
        testController.items.add(parent);

        // Simulates a parameterized test result child as its a child with no URI.
        const child = testController.createTestItem("child", "child");
        parent.children.add(child);

        updateTests(testController, [], fileUri);

        assert.deepStrictEqual(testControllerChildren(testController.items), []);
    });

    test("merges test item children", () => {
        const foo = testController.createTestItem("foo", "foo");
        const baz = testController.createTestItem("baz", "baz");
        foo.children.add(baz);
        testController.items.add(foo);

        const newFoo = testItem("foo");
        newFoo.children = [testItem("baz"), testItem("bar")];

        updateTests(testController, [newFoo]);

        assert.deepStrictEqual(testControllerChildren(testController.items), [
            {
                id: "foo",
                tags: [{ id: "XCTest" }, { id: "runnable" }],
                children: [
                    { id: "baz", tags: [{ id: "XCTest" }, { id: "runnable" }], children: [] },
                    { id: "bar", tags: [{ id: "XCTest" }, { id: "runnable" }], children: [] },
                ],
            },
        ]);
    });

    test("handles moving a test from one file to another", () => {
        const startUri = vscode.Uri.file("file:///some/file.swift");
        const test = testController.createTestItem("foo", "foo", startUri);
        const bar = testController.createTestItem("bar", "bar");
        test.children.add(bar);
        testController.items.add(test);

        const newLocation = new vscode.Location(
            vscode.Uri.file("file:///another/file.swift"),
            new vscode.Range(new vscode.Position(1, 0), new vscode.Position(2, 0))
        );

        const newBar = testItem("bar");
        newBar.location = newLocation;

        const newFoo = testItem("foo");
        newFoo.label = "New Label";
        newFoo.location = newLocation;
        newFoo.children = [newBar];

        updateTests(testController, [newFoo]);

        assert.deepStrictEqual(testControllerChildren(testController.items), [
            {
                id: "foo",
                tags: [{ id: "XCTest" }, { id: "runnable" }],
                children: [
                    { id: "bar", tags: [{ id: "XCTest" }, { id: "runnable" }], children: [] },
                ],
            },
        ]);
        assert.deepStrictEqual(testController.items.get("foo")?.uri, newLocation.uri);
        assert.deepStrictEqual(testController.items.get("foo")?.label, "New Label");
    });

    test("handles adding tests that are disambiguated by a file/location", () => {
        const child1 = testItem("AppTarget.example(_:)/AppTarget.swift:4:2", "swift-testing");
        const child2 = testItem("AppTarget.example(_:)/AppTarget.swift:16:2", "swift-testing");

        updateTestsForTarget(testController, { id: "AppTarget", label: "AppTarget" }, [
            child1,
            child2,
        ]);

        assert.deepStrictEqual(testControllerChildren(testController.items), [
            {
                id: "AppTarget",
                tags: [{ id: "test-target" }, { id: "runnable" }],
                children: [
                    {
                        id: "AppTarget.example(_:)/AppTarget.swift:4:2",
                        tags: [{ id: "swift-testing" }, { id: "runnable" }],
                        children: [],
                    },
                    {
                        id: "AppTarget.example(_:)/AppTarget.swift:16:2",
                        tags: [{ id: "swift-testing" }, { id: "runnable" }],
                        children: [],
                    },
                ],
            },
        ]);
    });

    test("handles adding a test to an existing parent when updating with a partial tree", () => {
        const child = testItem("AppTarget.AppTests/ChildTests/SubChildTests", "swift-testing");

        updateTestsForTarget(testController, { id: "AppTarget", label: "AppTarget" }, [child]);

        assert.deepStrictEqual(testControllerChildren(testController.items), [
            {
                id: "AppTarget",
                tags: [{ id: "test-target" }, { id: "runnable" }],
                children: [
                    {
                        id: "AppTarget.AppTests",
                        tags: [{ id: "swift-testing" }, { id: "runnable" }],
                        children: [
                            {
                                id: "AppTarget.AppTests/ChildTests",
                                tags: [{ id: "swift-testing" }, { id: "runnable" }],
                                children: [
                                    {
                                        id: "AppTarget.AppTests/ChildTests/SubChildTests",
                                        tags: [{ id: "swift-testing" }, { id: "runnable" }],
                                        children: [],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]);
    });

    test("updates tests from classes within a swift package", async () => {
        const targetFolder = vscode.Uri.file("file:///some/");
        const swiftPackage = await SwiftPackage.create(
            targetFolder,
            workspaceContext.globalToolchain
        );
        const testTargetName = "TestTarget";
        const target: Target = {
            c99name: testTargetName,
            name: testTargetName,
            path: targetFolder.fsPath,
            type: TargetType.test,
            sources: [],
        };
        swiftPackage.getTargets = () => Promise.resolve([target]);
        swiftPackage.getTarget = () => Promise.resolve(target);

        const item = testItem("bar");
        item.location = new vscode.Location(
            vscode.Uri.file("file:///some/file.swift"),
            new vscode.Range(new vscode.Position(1, 0), new vscode.Position(2, 0))
        );
        await updateTestsFromClasses(testController, swiftPackage, [item]);

        assert.deepStrictEqual(testControllerChildren(testController.items), [
            {
                id: "TestTarget",
                tags: [{ id: "test-target" }, { id: "runnable" }],
                children: [
                    { id: "bar", tags: [{ id: "XCTest" }, { id: "runnable" }], children: [] },
                ],
            },
        ]);
    });

    test("Children in suites with tags inherit the suite's tags", async () => {
        const testSuite = testItem("suite");
        testSuite.tags = [{ id: "rootTag" }];
        const childSuite = testItem("childSuite");
        childSuite.tags = [{ id: "childSuiteTag" }];
        const childTest = testItem("childTest");
        childTest.tags = [{ id: "childTestTag" }];
        childSuite.children = [childTest];
        testSuite.children = [childSuite];

        updateTests(testController, [testSuite]);

        assert.deepEqual(testControllerChildren(testController.items), [
            {
                id: "suite",
                tags: [{ id: "XCTest" }, { id: "rootTag" }, { id: "runnable" }],
                children: [
                    {
                        id: "childSuite",
                        tags: [
                            { id: "XCTest" },
                            { id: "childSuiteTag" },
                            { id: "rootTag" },
                            { id: "runnable" },
                        ],
                        children: [
                            {
                                id: "childTest",
                                children: [],
                                tags: [
                                    { id: "XCTest" },
                                    { id: "childTestTag" },
                                    { id: "childSuiteTag" },
                                    { id: "rootTag" },
                                    { id: "runnable" },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]);
    });
});
