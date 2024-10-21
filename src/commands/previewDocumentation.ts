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

import * as path from "path";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import { WorkspaceContext } from "../WorkspaceContext";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import { executeTaskWithUI, updateAfterError } from "./utilities";
import { FolderContext } from "../FolderContext";
import { DocumentationPreviewEditor } from "../documentation/DocumentationPreviewEditor";

async function buildDocumentation(
    context: vscode.ExtensionContext,
    folderContext: FolderContext
): Promise<string | undefined> {
    const buildPath = path.join(folderContext.folder.fsPath, ".build", "vscode-swift");
    const outputPath = path.join(buildPath, "documentation-preview");
    await fs.rm(outputPath, { recursive: true, force: true });
    await fs.mkdir(outputPath, { recursive: true });
    const task = createSwiftTask(
        [
            "package",
            "--disable-sandbox",
            "generate-documentation",
            "--enable-experimental-combined-documentation",
            "--output-path",
            outputPath,
        ],
        "Build Documentation",
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        },
        folderContext.workspaceContext.toolchain,
        {
            DOCC_HTML_DIR: context.asAbsolutePath("assets/swift-docc-render"),
        }
    );
    const succeeded = await executeTaskWithUI(task, "Building Documentation", folderContext);
    updateAfterError(succeeded, folderContext);
    if (!succeeded) {
        vscode.window.showErrorMessage("Failed to build documentation via SwiftDocC");
        return;
    }
    return outputPath;
}

export async function previewDocumentation(
    context: vscode.ExtensionContext,
    workspace: WorkspaceContext
): Promise<void> {
    const folderContext = workspace.folders.at(0);
    if (!folderContext) {
        return;
    }

    const archive = await buildDocumentation(context, folderContext);
    if (!archive) {
        return;
    }

    const previewEditor = new DocumentationPreviewEditor(context, workspace);
    await previewEditor.show(archive);
}
