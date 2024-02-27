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

import * as vscode from "vscode";
import { FolderContext } from "../FolderContext";

export interface TestFunction {
    name: string;
    location: vscode.Location;
}

export interface TestClass {
    name: string;
    location: vscode.Location;
    functions: TestFunction[];
}

export interface TestTarget {
    name: string;
    folder: vscode.Uri;
    classes: TestClass[];
}

export function updateTestsFromClasses(
    folderContext: FolderContext,
    testClasses: TestClass[],
    filterFile?: vscode.Uri
) {
    const testExplorer = folderContext.testExplorer;
    if (!testExplorer) {
        return;
    }
    const targets = folderContext.swiftPackage.getTargets("test").map(target => {
        const classes = testClasses.filter(
            testClass =>
                folderContext.swiftPackage.getTarget(testClass.location.uri.fsPath) === target
        );
        return {
            name: target.name,
            folder: vscode.Uri.file(target.path),
            classes: classes,
        };
    });
    updateTests(testExplorer.controller, targets, filterFile);
}

export function updateTests(
    testController: vscode.TestController,
    testTargets: TestTarget[],
    filterFile?: vscode.Uri
) {
    // remove TestItems that aren't in testTarget list
    testController.items.forEach(targetItem => {
        const testTarget = testTargets.find(item => item.name === targetItem.id);
        if (testTarget) {
            const targetId = testTarget.name;
            targetItem.children.forEach(classItem => {
                const testClass = testTarget.classes.find(
                    item => `${targetId}.${item.name}` === classItem.id
                );
                if (testClass) {
                    const classId = `${targetId}.${testClass.name}`;
                    classItem.children.forEach(functionItem => {
                        // if we are filtering based on targets being one file and this
                        // function isn't in the file then ignore
                        if (filterFile && functionItem.uri !== filterFile) {
                            return;
                        }
                        const testFunction = testClass.functions.find(
                            item => `${classId}/${item.name}` === functionItem.id
                        );
                        if (!testFunction) {
                            classItem.children.delete(functionItem.id);
                        }
                    });
                } else if (!filterFile) {
                    targetItem.children.delete(classItem.id);
                }
            });
        } else if (!filterFile) {
            testController.items.delete(targetItem.id);
        }
    });

    // Add in new items, update items already in place
    testTargets.forEach(testTarget => {
        const targetItem =
            testController.items.get(testTarget.name) ??
            createTopLevelTestItem(testController, testTarget.name, testTarget.folder);
        testTarget.classes.forEach(testClass => {
            const classItem = updateChildTestItem(
                testController,
                targetItem,
                testClass.name,
                ".",
                testClass.location
            );
            testClass.functions.forEach(testFunction => {
                updateChildTestItem(
                    testController,
                    classItem,
                    testFunction.name,
                    "/",
                    testFunction.location
                );
            });
        });
    });
}

function createTopLevelTestItem(
    testController: vscode.TestController,
    name: string,
    uri?: vscode.Uri
): vscode.TestItem {
    const testItem = testController.createTestItem(name, name, uri);
    testController.items.add(testItem);
    return testItem;
}

function updateChildTestItem(
    testController: vscode.TestController,
    parent: vscode.TestItem,
    name: string,
    separator: string,
    location?: vscode.Location
): vscode.TestItem {
    const id = `${parent.id}${separator}${name}`;
    const testItem = parent.children.get(id);
    if (testItem) {
        if (testItem.uri === location?.uri) {
            testItem.range = location?.range;
            return testItem;
        }
        parent.children.delete(testItem.id);
    }
    const newTestItem = testController.createTestItem(id, name, location?.uri);
    newTestItem.range = location?.range;
    parent.children.add(newTestItem);
    return newTestItem;
}
