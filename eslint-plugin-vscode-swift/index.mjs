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
import { defineConfig } from "eslint/config";

import useCustomDisposable from "./use-custom-disposable.mjs";

const plugin = {
    meta: {
        name: "eslint-plugin-vscode-swift",
        version: "1.0.0",
        namespace: "vscode-swift",
    },
    rules: {
        "use-custom-disposable": useCustomDisposable,
    },
};

export default {
    ...plugin,
    configs: {
        recommended: defineConfig({
            plugins: { "vscode-swift": plugin },
            rules: {
                "vscode-swift/use-custom-disposable": "error",
            },
        }),
    },
};
