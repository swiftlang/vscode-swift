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
import { DocumentationPreviewEditor } from "./DocumentationPreviewEditor";
import { WorkspaceContext } from "../WorkspaceContext";
import { RenderNode } from "./webview/WebviewMessage";
import contextKeys from "../contextKeys";

export class DocumentationManager implements vscode.Disposable {
    private previewEditor?: DocumentationPreviewEditor;
    private editorUpdatedContentEmitter = new vscode.EventEmitter<RenderNode>();
    private editorRenderedEmitter = new vscode.EventEmitter<void>();

    constructor(
        private readonly extension: vscode.ExtensionContext,
        private readonly context: WorkspaceContext
    ) {}

    onPreviewDidUpdateContent = this.editorUpdatedContentEmitter.event;
    onPreviewDidRenderContent = this.editorRenderedEmitter.event;

    async launchDocumentationPreview(): Promise<boolean> {
        if (!contextKeys.supportsDocumentationRendering) {
            return false;
        }

        if (!this.previewEditor) {
            const folderContext = this.context.currentFolder;
            if (!folderContext) {
                return false;
            }

            this.previewEditor = new DocumentationPreviewEditor(this.extension, this.context);
            const subscriptions: vscode.Disposable[] = [
                this.previewEditor.onDidUpdateContent(content => {
                    //                    console.log(`message content:\n${JSON.stringify(content, null, 2)}`);
                    this.editorUpdatedContentEmitter.fire(content);
                }),
                this.previewEditor.onDidRenderContent(() => {
                    console.log(`rendered.`);
                    this.editorRenderedEmitter.fire();
                }),
                this.previewEditor.onDidDispose(() => {
                    subscriptions.forEach(d => d.dispose());
                    this.previewEditor = undefined;
                }),
            ];
        } else {
            this.previewEditor.reveal();
        }
        return true;
    }

    dispose() {
        this.previewEditor?.dispose();
    }
}
