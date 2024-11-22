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
import { RenderNode, WebviewMessage } from "./webview/WebviewMessage";
import { WorkspaceContext } from "../WorkspaceContext";
import { RenderDocumentationRequest } from "../sourcekit-lsp/extensions/RenderDocumentationRequest";

export class DocumentationPreviewEditor implements vscode.Disposable {
    private readonly webviewPanel: vscode.WebviewPanel;
    private subscriptions: vscode.Disposable[] = [];

    private disposeEmitter = new vscode.EventEmitter<void>();
    private updateContentEmitter = new vscode.EventEmitter<RenderNode>();

    constructor(
        private readonly extension: vscode.ExtensionContext,
        private readonly context: WorkspaceContext
    ) {
        const swiftDoccRenderPath = this.extension.asAbsolutePath("assets/swift-docc-render");
        // Create and hook up events for the WebviewPanel
        this.webviewPanel = vscode.window.createWebviewPanel(
            "swift.previewDocumentationEditor",
            "Preview Swift Documentation",
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(this.extension.asAbsolutePath("assets/documentation-webview")),
                    vscode.Uri.file(swiftDoccRenderPath),
                    ...context.folders.map(f => f.folder),
                ],
            }
        );
        const webviewBaseURI = this.webviewPanel.webview.asWebviewUri(
            vscode.Uri.file(swiftDoccRenderPath)
        );
        const scriptURI = this.webviewPanel.webview.asWebviewUri(
            vscode.Uri.file(this.extension.asAbsolutePath("assets/documentation-webview/index.js"))
        );
        fs.readFile(path.join(swiftDoccRenderPath, "index.html"), "utf-8").then(
            documentationHTML => {
                documentationHTML = documentationHTML
                    .replaceAll("{{BASE_PATH}}", webviewBaseURI.toString())
                    .replace("</body>", `<script src="${scriptURI.toString()}"></script></body>`);
                this.webviewPanel.webview.html = documentationHTML;
                this.subscriptions.push(
                    this.webviewPanel.webview.onDidReceiveMessage(this.receiveMessage.bind(this)),
                    vscode.window.onDidChangeActiveTextEditor(editor =>
                        this.renderDocumentation(editor)
                    ),
                    vscode.window.onDidChangeTextEditorSelection(event =>
                        this.renderDocumentation(event.textEditor)
                    ),
                    this.webviewPanel.onDidDispose(this.dispose.bind(this))
                );
                // Reveal the editor, but don't change the focus of the active text editor
                this.webviewPanel.reveal(undefined, true);
            }
        );
    }

    /** An event that is fired when the Documentation Preview Editor is disposed */
    onDidDispose = this.disposeEmitter.event;

    /** An event that is fired when the Documentation Preview Editor updates its content */
    onDidUpdateContent = this.updateContentEmitter.event;

    reveal() {
        this.webviewPanel.reveal();
    }

    dispose() {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.subscriptions = [];
        this.webviewPanel.dispose();
        this.disposeEmitter.fire();
    }

    private postMessage(message: WebviewMessage) {
        if (message.type === "update-content") {
            this.updateContentEmitter.fire(message.content);
        }
        this.webviewPanel.webview.postMessage(message);
    }

    private receiveMessage(message: WebviewMessage) {
        switch (message.type) {
            case "loaded":
                this.renderDocumentation(vscode.window.activeTextEditor);
                break;
        }
    }

    private async renderDocumentation(editor: vscode.TextEditor | undefined): Promise<void> {
        const document = editor?.document;
        if (!document || document.uri.scheme !== "file") {
            return undefined;
        }

        const response = await this.context.languageClientManager.useLanguageClient(
            async client => {
                return await client.sendRequest(RenderDocumentationRequest.type, {
                    textDocument: {
                        uri: document.uri.toString(),
                    },
                    position: editor.selection.start,
                });
            }
        );
        if (!response.content) {
            return;
        }
        this.postMessage({
            type: "update-content",
            content: this.parseRenderNode(response.content),
        });
    }

    private parseRenderNode(content: string): RenderNode {
        const renderNode: RenderNode = JSON.parse(content);
        for (const referenceKey of Object.getOwnPropertyNames(renderNode.references)) {
            const reference = renderNode.references[referenceKey];
            for (const variant of reference.variants ?? []) {
                const uri = vscode.Uri.parse(variant.url).with({ scheme: "file" });
                variant.url = this.webviewPanel.webview.asWebviewUri(uri).toString();
            }
        }
        return renderNode;
    }
}
