//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { window } from "vscode";
import { WorkspaceContext } from "../WorkspaceContext";

export async function evaluateExpression(context: WorkspaceContext): Promise<void> {
    const editor = window.activeTextEditor;

    // const multiline = !editor?.selection.isSingleLine ?? false;
    // const complete = true; // TODO(compnerd) determine if the input is complete
    const code = editor?.document.lineAt(editor?.selection.start.line).text;
    if (!code) {
        return;
    }

    const repl = context.getRepl();
    await repl.evaluate(code);
}
