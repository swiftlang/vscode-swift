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
            Identifier(node) {
                if (node.name !== "Disposable") {
                    return;
                }

                const services = ESLintUtils.getParserServices(context);
                const type = services.getTypeAtLocation(node);
                if (!type.symbol || type.symbol.name !== "Disposable") {
                    return;
                }

                if (
                    isSymbolDeclaredIn(
                        type.symbol,
                        sourceFile => !sourceFile.includes("src/utilities/Disposable")
                    )
                ) {
                    context.report({
                        messageId: "useCustomDisposable",
                        node,
                    });
                }
            },
        };
    },
    meta: {
        docs: {
            description: "Prefer using vscode-swift's custom disposable types.",
        },
        messages: {
            useCustomDisposable:
                "Use one of the disposable types from `src/utilities/Disposable.ts`.",
        },
        type: "suggestion",
        schema: [],
        defaultOptions: [],
    },
    name: "use-custom-disposable",
});
