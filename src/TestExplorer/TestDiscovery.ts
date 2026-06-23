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
import { LSPTestItem } from "../sourcekit-lsp/extensions";
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
 * Tags that should not be duplicated on TestItems when applying parent tags to children.
 */
const defaultTags = [runnableTag.id, "test-target", "XCTest", "swift-testing"];

/**
 * Update Test Controller TestItems based off array of TestClasses.
 *
 * The function creates the TestTargets based off the test targets in the Swift
 * Package
 * @param testController Test controller
 * @param swiftPackage A swift package containing test targets
 * @param testClasses Array of test classes
 */
export async function updateTestsFromClasses(
    testController: vscode.TestController,
    swiftPackage: SwiftPackage,
    testItems: TestClass[]
) {
    const targets = await swiftPackage.getTargets(TargetType.test);
    const results: TestClass[] = [];
    for (const target of targets) {
        const filteredItems: TestClass[] = [];
        for (const testItem of testItems) {
            if (
                testItem.location &&
                (await swiftPackage.getTarget(testItem.location.uri.fsPath)) === target
            ) {
                filteredItems.push(testItem);
            }
        }
        results.push({
            id: target.c99name,
            label: target.name,
            children: filteredItems,
            location: undefined,
            disabled: false,
            style: "test-target",
            tags: [],
        });
    }
    updateTests(testController, results);
}

function isFileDisambiguated(id: string): boolean {
    // a regex to check if the id ends with a string like "filename.swift:line:column"
    const regex = /^(.*\/)?([^/]+\.swift):(\d+):(\d+)$/;
    return regex.test(id);
}

export function updateTestsForTarget(
    testController: vscode.TestController,
    testTarget: { id: string; label: string },
    testItems: TestClass[],
    filterFile?: vscode.Uri
) {
    // Because swift-testing suites can be defined through nested extensions the tests
    // provided might not be directly parented to the test target. For instance, the
    // target might be `Foo`, and one of the child `testItems` might be `Foo.Bar/Baz`.
    // If we simply attach the `testItems` to the root test target then the intermediate
    // suite `Bar` will be dropped. To avoid this, we syntheize the intermediate children
    // just like we synthesize the test target.
    function synthesizeChildren(testItem: TestClass): TestClass {
        // Only Swift Testing tests can be nested in a way that requires synthesis.
        if (testItem.style === "XCTest") {
            return testItem;
        }

        const fileDisambiguated = isFileDisambiguated(testItem.id);
        const item = { ...testItem };
        // To determine if any root level test items are missing a parent we check how many
        // components there are in the ID. If there are more than one (the test target) then
        // we synthesize all the intermediary test items.
        const idComponents = testItem.id.split(/[./]/);

        // Remove the last component to get the parent ID components
        idComponents.pop();

        // If this is a file disambiguated id (ends in <file>.swift:<line>:<column>),
        // remove both the filename and line info.
        if (fileDisambiguated) {
            idComponents.pop();
        }

        if (idComponents.length > (fileDisambiguated ? 2 : 1)) {
            let newId = idComponents.slice(0, 2).join(".");
            const remainingIdComponents = idComponents.slice(2);
            if (remainingIdComponents.length) {
                newId += "/" + remainingIdComponents.join("/");
            }
            return synthesizeChildren({
                id: newId,
                label: idComponents[idComponents.length - 1],
                children: [item],
                location: undefined,
                disabled: false,
                style: item.style,
                tags: item.tags,
            });
        }
        return item;
    }

    const testTargetClass: TestClass = {
        id: testTarget.id,
        label: testTarget.label,
        children: testItems.map(synthesizeChildren),
        location: undefined,
        disabled: false,
        style: "test-target",
        tags: [],
    };
    updateTests(testController, [testTargetClass], filterFile);
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
 * Given a `TestClass` adds the TestClasses tags to each of its children.
 * Does not apply recursively.
 * @param testClass A test class whose tags should be propagated to its children.
 * @returns A `TestClass` whose children include the parent's tags.
 */
function applyTagsToChildren(testClass: TestClass): TestClass {
    const tagsToAdd = testClass.tags.filter(tag => !defaultTags.includes(tag.id));
    return {
        ...testClass,
        children: testClass.children.map(child => ({
            ...child,
            tags: [...child.tags, ...tagsToAdd],
        })),
    };
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

    // In VS Code tags are not inherited automatically, so if we're recieving a suite we need
    // to set a suites tag on all of its children. Because test items are added top down the children
    // aren't updated recursively all at once, but rather one level at a time which then propagages
    // parent tags down the tree as children are upserted.
    testItem = applyTagsToChildren(testItem);

    const hasTestStyleTag = testItem.tags.find(tag => tag.id === testItem.style);

    // Manually add the test style as a tag if it isn't already in the tags list.
    // This lets the user filter by test type.
    newItem.tags = hasTestStyleTag
        ? [...testItem.tags]
        : [{ id: testItem.style }, ...testItem.tags];

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
