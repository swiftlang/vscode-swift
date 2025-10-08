//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { LSPErrorCodes, ResponseError } from "vscode-languageclient";

import { WorkspaceContext } from "../WorkspaceContext";
import { DocCDocumentationRequest, DocCDocumentationResponse } from "../sourcekit-lsp/extensions";
import { RenderNode, WebviewContent, WebviewMessage } from "./webview/WebviewMessage";

// eslint-disable-next-line @typescript-eslint/no-require-imports
import throttle = require("lodash.throttle");

export enum PreviewEditorConstant {
    VIEW_TYPE = "swift.previewDocumentationEditor",
    TITLE = "Preview Swift Documentation",
    UNSUPPORTED_EDITOR_ERROR_MESSAGE = "The active text editor does not support Swift Documentation Live Preview",
}

export class DocumentationPreviewEditor implements vscode.Disposable {
    static async create(
        extension: vscode.ExtensionContext,
        context: WorkspaceContext
    ): Promise<DocumentationPreviewEditor> {
        const swiftDoccRenderPath = extension.asAbsolutePath(
            path.join("assets", "swift-docc-render")
        );
        const webviewPanel = vscode.window.createWebviewPanel(
            PreviewEditorConstant.VIEW_TYPE,
            PreviewEditorConstant.TITLE,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(
                        extension.asAbsolutePath(
                            path.join("node_modules", "@vscode/codicons", "dist")
                        )
                    ),
                    vscode.Uri.file(
                        extension.asAbsolutePath(path.join("assets", "documentation-webview"))
                    ),
                    vscode.Uri.file(swiftDoccRenderPath),
                    ...context.folders.map(f => f.folder),
                ],
            }
        );
        webviewPanel.iconPath = {
            light: vscode.Uri.file(
                extension.asAbsolutePath(
                    path.join("assets", "icons", "light", "swift-documentation.svg")
                )
            ),
            dark: vscode.Uri.file(
                extension.asAbsolutePath(
                    path.join("assets", "icons", "dark", "swift-documentation.svg")
                )
            ),
        };
        const webviewBaseURI = webviewPanel.webview.asWebviewUri(
            vscode.Uri.file(swiftDoccRenderPath)
        );
        const scriptURI = webviewPanel.webview.asWebviewUri(
            vscode.Uri.file(
                extension.asAbsolutePath(path.join("assets", "documentation-webview", "index.js"))
            )
        );
        let doccRenderHTML = await fs.readFile(
            path.join(swiftDoccRenderPath, "index.html"),
            "utf-8"
        );
        const codiconsUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.file(
                extension.asAbsolutePath(
                    path.join("node_modules", "@vscode/codicons", "dist", "codicon.css")
                )
            )
        );
        doccRenderHTML = doccRenderHTML
            .replaceAll("{{BASE_PATH}}", webviewBaseURI.toString())
            .replace("</head>", `<link href="${codiconsUri}" rel="stylesheet" /></head>`)
            .replace("</body>", `<script src="${scriptURI.toString()}"></script></body>`);
        webviewPanel.webview.html = doccRenderHTML;
        return new DocumentationPreviewEditor(context, webviewPanel);
    }

    private activeTextEditor?: vscode.TextEditor;
    private activeTextEditorSelection?: vscode.Selection;
    private subscriptions: vscode.Disposable[] = [];
    private isDisposed: boolean = false;

    private disposeEmitter = new vscode.EventEmitter<void>();
    private renderEmitter = new vscode.EventEmitter<void>();
    private updateContentEmitter = new vscode.EventEmitter<WebviewContent>();

    private constructor(
        private readonly context: WorkspaceContext,
        private readonly webviewPanel: vscode.WebviewPanel
    ) {
        this.activeTextEditor = vscode.window.activeTextEditor;
        this.subscriptions.push(
            this.webviewPanel.webview.onDidReceiveMessage(this.receiveMessage, this),
            vscode.window.onDidChangeActiveTextEditor(this.handleActiveTextEditorChange, this),
            vscode.window.onDidChangeTextEditorSelection(this.handleSelectionChange, this),
            vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange, this),
            this.webviewPanel.onDidDispose(this.dispose, this)
        );
        this.reveal();
    }

    /** An event that is fired when the Documentation Preview Editor is disposed */
    onDidDispose = this.disposeEmitter.event;

    /** An event that is fired when the Documentation Preview Editor updates its content */
    onDidUpdateContent = this.updateContentEmitter.event;

    /** An event that is fired when the Documentation Preview Editor renders its content */
    onDidRenderContent = this.renderEmitter.event;

    reveal() {
        // Reveal the editor, but don't change the focus of the active text editor
        this.webviewPanel.reveal(undefined, true);
    }

    dispose() {
        this.isDisposed = true;
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.subscriptions = [];
        this.webviewPanel.dispose();
        this.disposeEmitter.fire();
    }

    private postMessage(message: WebviewMessage) {
        if (this.isDisposed) {
            return;
        }
        if (message.type === "update-content") {
            this.updateContentEmitter.fire(message.content);
        }
        void this.webviewPanel.webview.postMessage(message);
    }

    private receiveMessage(message: WebviewMessage) {
        switch (message.type) {
            case "loaded":
                if (!this.activeTextEditor) {
                    break;
                }
                void this.convertDocumentation(this.activeTextEditor);
                break;
            case "rendered":
                this.renderEmitter.fire();
                break;
        }
    }

    private handleActiveTextEditorChange(activeTextEditor: vscode.TextEditor | undefined) {
        if (this.activeTextEditor === activeTextEditor || activeTextEditor === undefined) {
            return;
        }
        this.activeTextEditor = activeTextEditor;
        this.activeTextEditorSelection = activeTextEditor.selection;
        void this.convertDocumentation(activeTextEditor);
    }

    private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
        if (
            this.activeTextEditor !== event.textEditor ||
            this.activeTextEditorSelection === event.textEditor.selection
        ) {
            return;
        }
        this.activeTextEditorSelection = event.textEditor.selection;
        void this.convertDocumentation(event.textEditor);
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (this.activeTextEditor?.document === event.document) {
            void this.convertDocumentation(this.activeTextEditor);
        }
    }

    private convertDocumentation = throttle(
        async (textEditor: vscode.TextEditor): Promise<void> => {
            const document = textEditor.document;
            if (
                document.uri.scheme !== "file" ||
                !["markdown", "tutorial", "swift"].includes(document.languageId)
            ) {
                this.postMessage({
                    type: "update-content",
                    content: {
                        type: "error",
                        errorMessage: PreviewEditorConstant.UNSUPPORTED_EDITOR_ERROR_MESSAGE,
                    },
                });
                return;
            }

            const folderContext = this.context.folders.find(folderContext =>
                document.uri.fsPath.startsWith(folderContext.folder.fsPath)
            );

            if (!folderContext) {
                return;
            }

            const languageClientManager = this.context.languageClientManager.get(folderContext);
            try {
                const response = await languageClientManager.useLanguageClient(
                    async (client): Promise<DocCDocumentationResponse> => {
                        return await client.sendRequest(DocCDocumentationRequest.type, {
                            textDocument: {
                                uri: document.uri.toString(),
                            },
                            position: textEditor.selection.start,
                        });
                    }
                );
                this.postMessage({
                    type: "update-content",
                    content: {
                        type: "render-node",
                        renderNode: this.parseRenderNode(response.renderNode),
                    },
                });
            } catch (error) {
                // Update the preview editor to reflect what error occurred
                let livePreviewErrorMessage = "An internal error occurred";
                const baseLogErrorMessage = `SourceKit-LSP request "${DocCDocumentationRequest.method}" failed: `;
                if (error instanceof ResponseError) {
                    if (error.code === LSPErrorCodes.RequestCancelled) {
                        // We can safely ignore cancellations
                        return undefined;
                    }
                    switch (error.code) {
                        case LSPErrorCodes.RequestFailed:
                            // RequestFailed response errors can be shown to the user
                            livePreviewErrorMessage = error.message;
                            break;
                        default:
                            // We should log additional info for other response errors
                            this.context.logger.error(
                                baseLogErrorMessage + JSON.stringify(error.toJson(), undefined, 2)
                            );
                            break;
                    }
                } else {
                    this.context.logger.error(baseLogErrorMessage + `${error}`);
                }
                this.postMessage({
                    type: "update-content",
                    content: {
                        type: "error",
                        errorMessage: livePreviewErrorMessage,
                    },
                });
            }
        },
        100 /* 10 times per second */,
        { trailing: true }
    );

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
