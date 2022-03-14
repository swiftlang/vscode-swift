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
import * as langclient from "vscode-languageclient/node";
import * as path from "path";
import { FolderContext } from "../FolderContext";
import { isPathInsidePath } from "../utilities/utilities";
import { getFileSymbols } from "../sourcekit-lsp/DocumentSymbols";
import { Target } from "../SwiftPackage";

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
    private functions: LSPFunction[];
    private targetName?: string;

    constructor(
        public uri: vscode.Uri,
        private folderContext: FolderContext,
        private controller: vscode.TestController
    ) {
        this.functions = [];
        this.targetName = this.getTarget(uri)?.name;
    }

    /**
     * Return if function was found via LSP server symbol search
     * @param targetName Target name
     * @param className Class name
     * @param funcName Function name
     * @returns Function from by LSP server symbol search
     */
    includesFunction(targetName: string, className: string, funcName: string): boolean {
        if (targetName !== this.targetName) {
            return false;
        }
        return (
            this.functions.find(
                element => element.className === className && element.funcName === funcName
            ) !== undefined
        );
    }

    /**
     * Called whenever a document becomes active. It stores a record of all the functions
     * in the file so it can be compared against in the onSave function
     * @param uri Uri of document just made active
     */
    async setActive() {
        if (!this.targetName) {
            return;
        }
        this.functions = await this.lspGetFunctionList(this.uri);

        // add functions to target test item if it exists
        this.addTestItems();
    }

    /**
     * Called whenever a file is saved. If it is a test file it will add any new tests it finds
     * and will compare against the list stored when the file was first made active to decide
     * on what tests should be removed
     * @param uri Uri of file being saved
     */
    async onDidSave(uri: vscode.Uri) {
        if (!this.targetName || this.uri !== uri) {
            return;
        }
        const targetItem = this.controller.items.get(this.targetName);
        if (!targetItem) {
            return;
        }
        const functions = await this.lspGetFunctionList(uri);
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

        this.addTestItemsToTarget(targetItem);

        // delete functions that are no longer here
        for (const f of deletedFunctions) {
            const classId = `${this.targetName}.${f.className}`;
            const classItem = targetItem.children.get(classId);
            if (!classItem) {
                continue;
            }
            const funcId = `${this.targetName}.${f.className}/${f.funcName}`;
            classItem.children.delete(funcId);
        }
    }

    addTestItems() {
        if (!this.targetName) {
            return;
        }
        const targetItem = this.controller.items.get(this.targetName);
        if (!targetItem) {
            return;
        }
        this.addTestItemsToTarget(targetItem);
    }

    private addTestItemsToTarget(targetItem: vscode.TestItem) {
        const targetName = targetItem.id;
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
    async lspGetFunctionList(uri: vscode.Uri): Promise<LSPFunction[]> {
        const results: LSPFunction[] = [];

        try {
            const symbols = await getFileSymbols(
                uri,
                this.folderContext.workspaceContext.languageClientManager
            );
            if (!symbols) {
                return [];
            }
            const classes = symbols.filter(item => item.kind === langclient.SymbolKind.Class);
            classes.forEach(c => {
                const testFunctions = c.children?.filter(
                    child =>
                        child.kind === langclient.SymbolKind.Method &&
                        child.name.match(/^test.*\(\)/)
                );
                testFunctions?.forEach(func => {
                    // drop "()" from function name
                    const range = new vscode.Range(
                        func.range.start.line,
                        func.range.start.character,
                        func.range.end.line,
                        func.range.end.character
                    );
                    results.push({
                        className: c.name,
                        funcName: func.name.slice(0, -2),
                        range: range,
                    });
                });
            });
            return results;
        } catch {
            return [];
        }
    }

    /**
     * Find testTarget for URI
     * @param uri URI to find target for
     * @returns Target
     */
    getTarget(uri: vscode.Uri): Target | undefined {
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
