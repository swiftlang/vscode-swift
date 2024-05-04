//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { FolderContext } from "../FolderContext";
import { TargetType } from "../SwiftPackage";
import { LSPTestItem } from "../sourcekit-lsp/lspExtensions";

/** Test class definition */
export interface TestClass extends Omit<Omit<LSPTestItem, "location">, "children"> {
    location: vscode.Location | undefined;
    children: TestClass[];
}

/**
 * Update Test Controller TestItems based off array of TestClasses.
 *
 * The function creates the TestTargets based off the test targets in the Swift
 * Package
 * @param folderContext Folder test classes came
 * @param testClasses Array of test classes
 */
export function updateTestsFromClasses(folderContext: FolderContext, testItems: TestClass[]) {
    const testExplorer = folderContext.testExplorer;
    if (!testExplorer) {
        return;
    }
    const targets = folderContext.swiftPackage.getTargets(TargetType.test).map(target => {
        const filteredItems = testItems.filter(
            testItem =>
                testItem.location &&
                folderContext.swiftPackage.getTarget(testItem.location.uri.fsPath) === target
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
    updateTests(testExplorer.controller, targets);
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
            collection.delete(testItem.id);
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
 * Updates the existing `vscode.TestItem` if it exists with the same ID as the `TestClass`,
 * otherwise creates an add a new one. The location on the returned vscode.TestItem is always updated.
 */
function upsertTestItem(
    testController: vscode.TestController,
    testItem: TestClass,
    parent?: vscode.TestItem
) {
    // This is a temporary gate on adding swift-testing tests until there is code to
    // run them. See https://github.com/swift-server/vscode-swift/issues/757
    if (testItem.style === "swift-testing") {
        return;
    }

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
    } else {
        newItem = existingItem;
    }

    // Manually add the test style as a tag so we can filter by test type.
    newItem.tags = [{ id: testItem.style }, ...testItem.tags];
    newItem.label = testItem.label;
    newItem.range = testItem.location?.range;

    // Performs an upsert based on whether a test item exists in the collection with the same id.
    // If no parent is provided operate on the testController's root items.
    collection.add(newItem);

    testItem.children.forEach(child => {
        upsertTestItem(testController, child, newItem);
    });
}
