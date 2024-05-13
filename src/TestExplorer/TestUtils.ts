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
