//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
// @ts-check
import { ESLintUtils } from "@typescript-eslint/utils";
import { dirname } from "path";
import * as ts from "typescript";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const createRule = ESLintUtils.RuleCreator(
    ruleName => `file://${__dirname}/${ruleName}.mjs`
);

/**
 * Determines whether the symbol's source file name passes the provided predicate.
 *
 * @param {ts.Symbol | undefined} symbol The symbol to check.
 * @param {(fileName: string) => boolean} predicate A function that returns true if the source file matches some criteria.
 * @returns {boolean} True if the symbol is declared in a source file that matches the predicate.
 */
export function isSymbolDeclaredIn(symbol, predicate) {
    if (!symbol?.declarations) {
        return false;
    }

    return (
        symbol.declarations.findIndex(decl => {
            const sourceFile = findNameOfSourceFile(decl);
            if (!sourceFile) {
                return false;
            }
            return predicate(sourceFile);
        }) >= 0
    );
}

/**
 * Finds the name of the source file that contains the provided declaration, if any.
 *
 * @param {ts.Declaration} decl The declaration.
 * @returns {string | undefined} The name of the source file if found.
 */
function findNameOfSourceFile(decl) {
    let currentNode = decl.parent;
    while (!!currentNode && !ts.isSourceFile(currentNode)) {
        currentNode = currentNode.parent;
    }
    if (!currentNode) {
        return undefined;
    }
    return currentNode.fileName;
}
