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
import * as fs from "fs/promises";
import * as path from "path";
import { DocumentationPreviewEditor } from "./DocumentationPreviewEditor";
import { WorkspaceContext } from "../WorkspaceContext";
import { FolderContext } from "../FolderContext";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import { executeTaskWithUI, updateAfterError } from "../commands/utilities";

export class DocumentationManager {
    private previewEditor?: DocumentationPreviewEditor;

    constructor(
        private readonly extension: vscode.ExtensionContext,
        private readonly context: WorkspaceContext
    ) {}

    async launchDocumentationPreview(): Promise<void> {
        if (!this.previewEditor) {
            const folderContext = this.context.folders.at(0);
            if (!folderContext) {
                return;
            }

            const archive = await this.buildDocumentation(folderContext);
            if (!archive) {
                return;
            }

            this.previewEditor = new DocumentationPreviewEditor(
                archive,
                this.extension,
                this.context
            );
            const subscriptions: vscode.Disposable[] = [
                this.previewEditor.onDidDispose(() => {
                    subscriptions.forEach(d => d.dispose());
                    this.previewEditor = undefined;
                }),
            ];
        }
    }

    async buildDocumentation(folderContext: FolderContext): Promise<string | undefined> {
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
                DOCC_HTML_DIR: this.extension.asAbsolutePath("assets/swift-docc-render"),
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
}
