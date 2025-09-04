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

import { WorkspaceContext } from "../WorkspaceContext";
import { DocumentationPreviewEditor } from "./DocumentationPreviewEditor";
import { WebviewContent } from "./webview/WebviewMessage";

export class DocumentationManager implements vscode.Disposable {
    private previewEditor?: DocumentationPreviewEditor;
    private editorUpdatedContentEmitter = new vscode.EventEmitter<WebviewContent>();
    private editorRenderedEmitter = new vscode.EventEmitter<void>();

    constructor(
        private readonly extension: vscode.ExtensionContext,
        private readonly workspaceContext: WorkspaceContext
    ) {}

    onPreviewDidUpdateContent = this.editorUpdatedContentEmitter.event;
    onPreviewDidRenderContent = this.editorRenderedEmitter.event;

    async launchDocumentationPreview(): Promise<boolean> {
        if (!this.workspaceContext.contextKeys.supportsDocumentationLivePreview) {
            return false;
        }

        if (!this.previewEditor) {
            const folderContext = this.workspaceContext.currentFolder;
            if (!folderContext) {
                return false;
            }

            this.previewEditor = await DocumentationPreviewEditor.create(
                this.extension,
                this.workspaceContext
            );
            const subscriptions: vscode.Disposable[] = [
                this.previewEditor.onDidUpdateContent(content => {
                    this.editorUpdatedContentEmitter.fire(content);
                }),
                this.previewEditor.onDidRenderContent(() => {
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
