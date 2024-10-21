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
import { WebviewEvent } from "./webview/events";
import { WorkspaceContext } from "../WorkspaceContext";
import { Target } from "../SwiftPackage";

export class DocumentationPreviewEditor implements vscode.Disposable {
    private editorState: EditorState | undefined;
    private subscriptions: vscode.Disposable[] = [];

    constructor(
        private readonly extension: vscode.ExtensionContext,
        private readonly context: WorkspaceContext
    ) {}

    async show(archivePath: string): Promise<void> {
        if (!this.editorState) {
            // Create and hook up events for the WebviewPanel
            const webviewPanel = vscode.window.createWebviewPanel(
                "swift.previewDocumentationEditor",
                "Preview Swift Documentation",
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.file(
                            this.extension.asAbsolutePath("assets/documentation-webview")
                        ),
                        vscode.Uri.file(archivePath),
                    ],
                }
            );
            const webviewBaseURI = webviewPanel.webview.asWebviewUri(vscode.Uri.file(archivePath));
            const scriptURI = webviewPanel.webview.asWebviewUri(
                vscode.Uri.file(
                    this.extension.asAbsolutePath("assets/documentation-webview/index.js")
                )
            );
            const documentationHTML = (
                await fs.readFile(path.join(archivePath, "index.html"), "utf-8")
            )
                .replaceAll("{{BASE_PATH}}", webviewBaseURI.toString())
                .replace("</body>", `<script src="${scriptURI.toString()}"></script></body>`);
            webviewPanel.webview.html = documentationHTML;
            // Initialize the editor state
            const initialPath =
                extractPathFromTextDocument(vscode.window.activeTextEditor, this.context) ??
                getDefaultDocumentationPath(this.context);
            this.editorState = {
                archivePath,
                webviewPanel,
                webviewState: {
                    type: "initializing",
                    messageQueue: [{ type: "initialize", route: initialPath }],
                },
            };
            this.subscriptions.push(
                webviewPanel.webview.onDidReceiveMessage(this.receiveMessage.bind(this)),
                vscode.window.onDidChangeActiveTextEditor(this.activeTextEditorChanged.bind(this)),
                webviewPanel.onDidDispose(this.dispose.bind(this))
            );
        }

        // Reveal the editor, but don't change the focus of the active text editor
        this.editorState.webviewPanel.reveal(undefined, true);
    }

    dispose() {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.subscriptions = [];
        this.editorState?.webviewPanel.dispose();
        this.editorState = undefined;
    }

    private postMessage(message: WebviewEvent): void {
        if (!this.editorState) {
            return;
        }

        const { webviewPanel, webviewState } = this.editorState;
        if (webviewState.type === "initializing") {
            webviewState.messageQueue.push(message);
        } else {
            webviewPanel.webview.postMessage(message);
        }
    }

    private receiveMessage(event: WebviewEvent) {
        if (!this.editorState) {
            return;
        }

        const { webviewPanel, webviewState } = this.editorState;
        if (event.type === "ready" && webviewState.type === "initializing") {
            for (const message of webviewState.messageQueue) {
                webviewPanel.webview.postMessage(message);
            }
            webviewState.type = "ready";
            webviewState.messageQueue = [];
        }
    }

    private activeTextEditorChanged(editor: vscode.TextEditor | undefined) {
        if (!this.editorState) {
            return;
        }

        const newPath = extractPathFromTextDocument(editor, this.context);
        if (newPath) {
            fs.readFile(
                path.join(this.editorState.archivePath, "data", newPath + ".json"),
                "utf-8"
            ).then(contents => {
                this.postMessage({ type: "update-content", data: JSON.parse(contents) });
            });
        }
    }
}

function findTargetForFile(file: string, ctx: WorkspaceContext): Target | undefined {
    for (const folder of ctx.folders) {
        const target = folder.swiftPackage.getTarget(file);
        if (!target) {
            continue;
        }
        return target;
    }
    return undefined;
}

function extractPathFromTextDocument(
    editor: vscode.TextEditor | undefined,
    ctx: WorkspaceContext
): string | undefined {
    const document = editor?.document;
    if (!document || document.uri.scheme !== "file") {
        return undefined;
    }

    const target = findTargetForFile(document.uri.fsPath, ctx);
    if (target?.type !== "executable" && target?.type !== "library") {
        return;
    }

    return `/documentation/${target.name.toLocaleLowerCase()}`;
}

function getDefaultDocumentationPath(ctx: WorkspaceContext): string {
    for (const folder of ctx.folders) {
        for (const target of folder.swiftPackage.targets) {
            if (target.type === "executable" || target.type === "library") {
                return `/documentation/${target.name}`;
            }
        }
    }
    return "/documentation";
}

interface EditorState {
    archivePath: string;
    webviewPanel: vscode.WebviewPanel;
    webviewState: WebviewState;
}

type WebviewState = {
    type: "initializing" | "ready";
    messageQueue: WebviewEvent[];
};
