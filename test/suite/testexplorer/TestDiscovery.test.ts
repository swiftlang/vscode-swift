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
import * as vscode from "vscode";
import { beforeEach } from "mocha";
import {
    TestClass,
    updateTests,
    updateTestsFromClasses,
} from "../../../src/TestExplorer/TestDiscovery";
import { reduceTestItemChildren } from "../../../src/TestExplorer/TestUtils";
import { SwiftPackage, Target, TargetType } from "../../../src/SwiftPackage";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";

suite("TestDiscovery Suite", () => {
    let testController: vscode.TestController;
    let testRunCtr = 0;

    interface SimplifiedTestItem {
        id: string;
        children: SimplifiedTestItem[];
    }

    function testControllerChildren(collection: vscode.TestItemCollection): SimplifiedTestItem[] {
        return reduceTestItemChildren(
            collection,
            (acc, item) => [
                ...acc,
                { id: item.id, children: testControllerChildren(item.children) },
            ],
            [] as SimplifiedTestItem[]
        );
    }

    function testItem(id: string): TestClass {
        return {
            id,
            label: id,
            disabled: false,
            style: "XCTest",
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
            { id: "bar", children: [] },
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
                children: [
                    { id: "baz", children: [] },
                    { id: "bar", children: [] },
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
            { id: "foo", children: [{ id: "bar", children: [] }] },
        ]);
        assert.deepStrictEqual(testController.items.get("foo")?.uri, newLocation.uri);
        assert.deepStrictEqual(testController.items.get("foo")?.label, "New Label");
    });

    test("updates tests from classes within a swift package", async () => {
        const file = vscode.Uri.file("file:///some/file.swift");
        const swiftPackage = await SwiftPackage.create(file, await SwiftToolchain.create());
        const testTargetName = "TestTarget";
        const target: Target = {
            c99name: testTargetName,
            name: testTargetName,
            path: file.fsPath,
            type: TargetType.test,
            sources: [],
        };
        swiftPackage.getTargets = () => [target];
        swiftPackage.getTarget = () => target;

        const item = testItem("bar");
        item.location = new vscode.Location(
            vscode.Uri.file("file:///another/file.swift"),
            new vscode.Range(new vscode.Position(1, 0), new vscode.Position(2, 0))
        );
        updateTestsFromClasses(testController, swiftPackage, [item]);

        assert.deepStrictEqual(testControllerChildren(testController.items), [
            { id: "TestTarget", children: [{ id: "bar", children: [] }] },
        ]);
    });
});
