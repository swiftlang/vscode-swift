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

import { createRule, isSymbolDeclaredIn } from "./utilities.mjs";

export default createRule({
    create(context) {
        return {
            CallExpression(node) {
                const services = ESLintUtils.getParserServices(context);
                const type = services.getTypeAtLocation(node.callee);

                if (
                    !isSymbolDeclaredIn(type.symbol, sourceFile =>
                        sourceFile.includes("@types/mocha")
                    )
                ) {
                    return;
                }

                if (type.symbol.name === "ExclusiveSuiteFunction") {
                    context.report({
                        messageId: "noExclusiveSuites",
                        node: node.callee,
                    });
                    return;
                }

                if (type.symbol.name === "ExclusiveTestFunction") {
                    context.report({
                        messageId: "noExclusiveTests",
                        node: node.callee,
                    });
                }
            },
        };
    },
    meta: {
        docs: {
            description: "Prohibit the use of suite.only() and test.only().",
        },
        messages: {
            noExclusiveTests: "Remove .only() from your test case.",
            noExclusiveSuites: "Remove .only() from your test suite.",
        },
        type: "suggestion",
        schema: [],
        defaultOptions: [],
    },
    name: "no-exclusive-tests",
});
