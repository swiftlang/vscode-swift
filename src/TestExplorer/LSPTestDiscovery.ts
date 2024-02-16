//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import { FolderContext } from "../FolderContext";
import { isPathInsidePath } from "../utilities/utilities";
import { Target } from "../SwiftPackage";

class LSPClass {
    constructor(public className: string, public range?: vscode.Range) {}
}

class LSPFunction {
    constructor(public className: string, public funcName: string, public range?: vscode.Range) {}
}

/**
 * Used to augment test discovery via `swift test --list-tests`.
 *
 * Uses document symbol request to keep a running copy of all the test methods
 * in a file. When a file is saved it checks to see if any new methods have been
 * added, or if any methods have been removed and edits the test items based on
 * these results.
 */
export class LSPTestDiscovery {
    private classes: LSPClass[];
    private functions: LSPFunction[];
    private testTargetName?: string;

    constructor(
        public uri: vscode.Uri,
        private folderContext: FolderContext,
        private controller: vscode.TestController
    ) {
        this.testTargetName = this.getTestTarget(uri)?.name;
        this.classes = [];
        this.functions = [];
    }

    /**
     * Return if function was found via LSP server symbol search
     * @param targetName Target name
     * @param className Class name
     * @param funcName Function name
     * @returns Function from by LSP server symbol search
     */
    includesFunction(targetName: string, className: string, funcName: string): boolean {
        if (targetName !== this.testTargetName) {
            return false;
        }
        return (
            this.functions.find(
                element => element.className === className && element.funcName === funcName
            ) !== undefined
        );
    }

    /**
     * Add test items for the symbols we have found so far
     */
    addTestItems() {
        if (!this.testTargetName) {
            return;
        }
        const targetItem = this.controller.items.get(this.testTargetName);
        if (!targetItem) {
            return;
        }
        this.addTestItemsToTarget(targetItem);
    }

    /**
     * Update test items based on document symbols returned from LSP server
     * @param symbols Document symbols returned from LSP server
     */
    updateTestItems(symbols: vscode.DocumentSymbol[]) {
        if (!this.testTargetName) {
            return;
        }

        const results = this.parseSymbolList(symbols);

        const targetItem = this.controller.items.get(this.testTargetName);
        if (!targetItem) {
            // if didn't find target item it probably hasn't been constructed yet
            // store the results for later use and return
            this.functions = results.functions;
            this.classes = results.classes;
            return;
        }
        const functions = results.functions;
        const deletedFunctions: LSPFunction[] = [];
        this.functions.forEach(element => {
            if (
                !functions.find(
                    element2 =>
                        element.className === element2.className &&
                        element.funcName === element2.funcName
                )
            ) {
                deletedFunctions.push(element);
            }
        });
        this.functions = functions;
        this.classes = results.classes;

        this.addTestItemsToTarget(targetItem);

        // delete functions that are no longer here
        for (const f of deletedFunctions) {
            const classId = `${this.testTargetName}.${f.className}`;
            const classItem = targetItem.children.get(classId);
            if (!classItem) {
                continue;
            }
            const funcId = `${this.testTargetName}.${f.className}/${f.funcName}`;
            classItem.children.delete(funcId);
        }

        // delete any empty classes
        targetItem.children.forEach(classItem => {
            if (classItem.children.size === 0) {
                targetItem.children.delete(classItem.id);
            }
        });
    }

    /** Add test items for LSP server results */
    private addTestItemsToTarget(targetItem: vscode.TestItem) {
        const targetName = targetItem.id;
        // set class positions
        for (const c of this.classes) {
            const classId = `${targetName}.${c.className}`;
            const classItem = targetItem.children.get(classId);
            if (!classItem) {
                continue;
            }
            if (!classItem.uri) {
                // Unfortunately TestItem.uri is readonly so have to create a new TestItem
                const children = classItem.children;
                targetItem.children.delete(classId);
                const newItem = this.controller.createTestItem(classId, c.className, this.uri);
                children.forEach(child => newItem.children.add(child));
                newItem.range = c.range;
                targetItem.children.add(newItem);
            } else {
                classItem.range = c.range;
            }
        }

        // add functions that didn't exist before
        for (const f of this.functions) {
            const classId = `${targetName}.${f.className}`;
            const classItem = targetItem.children.get(classId);
            if (!classItem) {
                continue;
            }
            const funcId = `${targetName}.${f.className}/${f.funcName}`;
            const funcItem = classItem.children.get(funcId);
            if (!funcItem) {
                const item = this.controller.createTestItem(funcId, f.funcName, this.uri);
                item.range = f.range;
                classItem.children.add(item);
            } else {
                // set function item uri and location
                if (!funcItem.uri) {
                    // Unfortunately TestItem.uri is readonly so have to create a new TestItem
                    // if we want to set the uri.
                    classItem.children.delete(funcId);
                    const newItem = this.controller.createTestItem(funcId, f.funcName, this.uri);
                    newItem.range = f.range;
                    classItem.children.add(newItem);
                } else {
                    funcItem.range = f.range;
                }
            }
        }
    }

    /**
     * Get list of class methods that start with the prefix "test" and have no parameters
     * ie possible test functions
     */
    parseSymbolList(symbols: vscode.DocumentSymbol[]): {
        classes: LSPClass[];
        functions: LSPFunction[];
    } {
        const resultClasses: LSPClass[] = [];
        const results: LSPFunction[] = [];

        // filter is class or extension
        const classes = symbols.filter(
            item =>
                item.kind === vscode.SymbolKind.Class || item.kind === vscode.SymbolKind.Namespace
        );
        classes.forEach(c => {
            // add class with position
            if (c.kind === vscode.SymbolKind.Class) {
                resultClasses.push({
                    className: c.name,
                    range: c.range,
                });
            }
            // filter test methods
            const testFunctions = c.children?.filter(
                child => child.kind === vscode.SymbolKind.Method && child.name.match(/^test.*\(\)/)
            );
            testFunctions?.forEach(func => {
                // drop "()" from function name
                results.push({
                    className: c.name,
                    funcName: func.name.slice(0, -2),
                    range: func.range,
                });
            });
        });
        return { classes: resultClasses, functions: results };
    }

    /**
     * Find testTarget for URI
     * @param uri URI to find target for
     * @returns Target
     */
    getTestTarget(uri: vscode.Uri): Target | undefined {
        if (!isPathInsidePath(uri.fsPath, this.folderContext.folder.fsPath)) {
            return undefined;
        }
        const testTargets = this.folderContext.swiftPackage.getTargets("test");
        const target = testTargets.find(element => {
            const relativeUri = path.relative(
                path.join(this.folderContext.folder.fsPath, element.path),
                uri.fsPath
            );
            return element.sources.find(file => file === relativeUri) !== undefined;
        });
        return target;
    }
}
