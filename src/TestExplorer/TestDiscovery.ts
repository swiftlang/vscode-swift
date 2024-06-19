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

import * as vscode from "vscode";
import { SwiftPackage, TargetType } from "../SwiftPackage";
import { LSPTestItem } from "../sourcekit-lsp/lspExtensions";
import { reduceTestItemChildren } from "./TestUtils";

/** Test class definition */
export interface TestClass extends Omit<Omit<LSPTestItem, "location">, "children"> {
    location: vscode.Location | undefined;
    children: TestClass[];
}

/**
 * Tag that denotes TestItems should be runnable in the VS Code UI.
 * Test items that do not have this tag will not have the green "run test" triangle button.
 */
export const runnableTag = new vscode.TestTag("runnable");

/**
 * Update Test Controller TestItems based off array of TestClasses.
 *
 * The function creates the TestTargets based off the test targets in the Swift
 * Package
 * @param testController Test controller
 * @param swiftPackage A swift package containing test targets
 * @param testClasses Array of test classes
 */
export function updateTestsFromClasses(
    testController: vscode.TestController,
    swiftPackage: SwiftPackage,
    testItems: TestClass[]
) {
    const targets = swiftPackage.getTargets(TargetType.test).map(target => {
        const filteredItems = testItems.filter(
            testItem =>
                testItem.location && swiftPackage.getTarget(testItem.location.uri.fsPath) === target
        );
        return {
            id: target.c99name,
            label: target.name,
            children: filteredItems,
            location: undefined,
            disabled: false,
            style: "test-target",
            tags: [],
        } as TestClass;
    });
    updateTests(testController, targets);
}

/**
 * Update Test Controller TestItems based off array of TestTargets
 * @param testController Test controller
 * @param testItems Array of TestClasses
 * @param filterFile Filter test deletion just for tests in the one file
 */
export function updateTests(
    testController: vscode.TestController,
    testItems: TestClass[],
    filterFile?: vscode.Uri
) {
    const incomingTestsLookup = createIncomingTestLookup(testItems);
    function removeOldTests(testItem: vscode.TestItem) {
        testItem.children.forEach(child => removeOldTests(child));

        // If the existing item isn't in the map
        if (
            !incomingTestsLookup.get(testItem.id) &&
            (!filterFile || testItem.uri?.fsPath === filterFile.fsPath)
        ) {
            const collection = testItem.parent ? testItem.parent.children : testController.items;

            if (
                testItem.children.size === 0 ||
                testItemHasParameterizedTestResultChildren(testItem)
            ) {
                collection.delete(testItem.id);
            }
        }
    }

    // Skip removing tests if the test explorer is empty
    if (testController.items.size !== 0) {
        testController.items.forEach(removeOldTests);
    }

    // Add/update the top level test items. upsertTestItem will descend the tree of children adding them as well.
    testItems.forEach(testItem => {
        upsertTestItem(testController, testItem);
    });
}

/**
 * Returns true if all children have no URI.
 * This indicates the test item is parameterized and the children are the results.
 */
function testItemHasParameterizedTestResultChildren(testItem: vscode.TestItem) {
    return (
        testItem.children.size > 0 &&
        reduceTestItemChildren(
            testItem.children,
            (acc, child) => acc || child.uri !== undefined,
            false
        ) === false
    );
}

/**
 * Create a lookup of the incoming tests we can compare to the existing list of tests
 * to produce a list of tests that are no longer present. If a filterFile is specified we
 * scope this work to just the tests inside that file.
 */
function createIncomingTestLookup(
    collection: TestClass[],
    filterFile?: vscode.Uri
): Map<string, TestClass> {
    const dictionary = new Map<string, TestClass>();
    function traverse(testItem: TestClass) {
        // If we are filtering based on tests being one file and this
        // function isn't in the file then ignore
        if (!filterFile || testItem.location?.uri.fsPath === filterFile.fsPath) {
            dictionary.set(testItem.id, testItem);
            testItem.children.forEach(item => traverse(item));
        }
    }
    collection.forEach(item => traverse(item));
    return dictionary;
}

/**
 * Merges the TestItems recursively from the `existingItem` in to the `newItem`
 */
function deepMergeTestItemChildren(existingItem: vscode.TestItem, newItem: vscode.TestItem) {
    reduceTestItemChildren(
        existingItem.children,
        (collection, testItem: vscode.TestItem) => {
            const existing = collection.get(testItem.id);
            if (existing) {
                deepMergeTestItemChildren(existing, testItem);
            }
            collection.add(testItem);
            return collection;
        },
        newItem.children
    );
}

/**
 * Updates the existing `vscode.TestItem` if it exists with the same ID as the `TestClass`,
 * otherwise creates an add a new one. The location on the returned vscode.TestItem is always updated.
 */
export function upsertTestItem(
    testController: vscode.TestController,
    testItem: TestClass,
    parent?: vscode.TestItem
): vscode.TestItem {
    const collection = parent?.children ?? testController.items;
    const existingItem = collection.get(testItem.id);
    let newItem: vscode.TestItem;

    // Unfortunately TestItem.uri is readonly so if the location of the test has changed
    // we need to create a new TestItem. If the location of the new test item is undefined
    // then don't create a new item and use the old one.
    if (
        existingItem === undefined ||
        (existingItem && testItem.location?.uri && existingItem.uri !== testItem.location.uri)
    ) {
        newItem = testController.createTestItem(
            testItem.id,
            testItem.label,
            testItem.location?.uri
        );

        // We want to keep existing children if they exist.
        if (existingItem) {
            const existingChildren: vscode.TestItem[] = [];
            existingItem.children.forEach(child => {
                existingChildren.push(child);
            });
            newItem.children.replace(existingChildren);
        }
    } else {
        newItem = existingItem;
    }

    // At this point all the test items that should have been deleted are out of the tree.
    // Its possible we're dropping a whole branch of test items on top of an existing one,
    // and we want to merge these branches instead of the new one replacing the existing one.
    if (existingItem) {
        deepMergeTestItemChildren(existingItem, newItem);
    }

    // Manually add the test style as a tag so we can filter by test type.
    newItem.tags = [{ id: testItem.style }, ...testItem.tags];

    if (testItem.disabled === false) {
        newItem.tags = [...newItem.tags, runnableTag];
    }

    newItem.label = testItem.label;
    newItem.range = testItem.location?.range;

    if (testItem.sortText) {
        newItem.sortText = testItem.sortText;
    } else if (!testItem.location) {
        // TestItems without a location should be sorted to the top.
        const zeros = ``.padStart(8, "0");
        newItem.sortText = `${zeros}:${testItem.label}`;
    }

    // Performs an upsert based on whether a test item exists in the collection with the same id.
    // If no parent is provided operate on the testController's root items.
    collection.add(newItem);

    testItem.children.forEach(child => {
        upsertTestItem(testController, child, newItem);
    });

    return newItem;
}
