//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

/**
 * An implementation of `reduce()` that operates on a vscode.TestItemCollection,
 * which only exposes `forEach` for iterating its items
 */
export function reduceTestItemChildren<U>(
    array: vscode.TestItemCollection,
    callback: (accumulator: U, currentValue: vscode.TestItem) => U,
    initialValue: U
): U {
    let accumulator = initialValue;
    array.forEach(currentValue => {
        accumulator = callback(accumulator, currentValue);
    });
    return accumulator;
}

/**
 * Returns a flattented, iterable collection of test items in the collection.
 */
export function flattenTestItemCollection(coll: vscode.TestItemCollection): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    coll.forEach(item => {
        items.push(item);
        items.push(...flattenTestItemCollection(item.children));
    });
    return items;
}
