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
import { WebviewMessage } from "./webview/WebviewMessage";
import { WorkspaceContext } from "../WorkspaceContext";
import { Target } from "../SwiftPackage";
import { fileExists } from "../utilities/filesystem";
import {
    findDocumentableSymbolAtPosition,
    convertSymbolToDocumentationRoute,
} from "./symbolSearch";
import { SymbolInfoRequest } from "../sourcekit-lsp/extensions";

export class DocumentationPreviewEditor implements vscode.Disposable {
    private readonly webviewPanel: vscode.WebviewPanel;
    private currentRoute: string;
    private subscriptions: vscode.Disposable[] = [];

    private disposeEmitter = new vscode.EventEmitter<void>();
    onDidDispose = this.disposeEmitter.event;

    constructor(
        private readonly archivePath: string,
        private readonly extension: vscode.ExtensionContext,
        private readonly context: WorkspaceContext
    ) {
        // Create and hook up events for the WebviewPanel
        this.webviewPanel = vscode.window.createWebviewPanel(
            "swift.previewDocumentationEditor",
            "Preview Swift Documentation",
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(this.extension.asAbsolutePath("assets/documentation-webview")),
                    vscode.Uri.file(archivePath),
                ],
            }
        );
        const webviewBaseURI = this.webviewPanel.webview.asWebviewUri(vscode.Uri.file(archivePath));
        const scriptURI = this.webviewPanel.webview.asWebviewUri(
            vscode.Uri.file(this.extension.asAbsolutePath("assets/documentation-webview/index.js"))
        );
        this.currentRoute = getDefaultDocumentationPath(this.context);
        Promise.all([
            this.findRouteFromTextDocument(vscode.window.activeTextEditor),
            fs.readFile(path.join(archivePath, "index.html"), "utf-8"),
        ]).then(([activeTextEditorRoute, documentationHTML]) => {
            if (activeTextEditorRoute) {
                this.currentRoute = activeTextEditorRoute;
            }
            documentationHTML = documentationHTML
                .replaceAll("{{BASE_PATH}}", webviewBaseURI.toString())
                .replace("</body>", `<script src="${scriptURI.toString()}"></script></body>`);
            this.webviewPanel.webview.html = documentationHTML;
            this.subscriptions.push(
                this.webviewPanel.webview.onDidReceiveMessage(this.receiveMessage.bind(this)),
                vscode.window.onDidChangeActiveTextEditor(this.activeTextEditorChanged.bind(this)),
                vscode.window.onDidChangeTextEditorSelection(
                    this.textEditorSelectionChanged.bind(this)
                ),
                this.webviewPanel.onDidDispose(this.dispose.bind(this))
            );
            // Reveal the editor, but don't change the focus of the active text editor
            this.webviewPanel.reveal(undefined, true);
        });
    }

    reveal() {
        this.webviewPanel.reveal();
    }

    dispose() {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.subscriptions = [];
        this.webviewPanel.dispose();
        this.disposeEmitter.fire();
    }

    private postMessage(message: WebviewMessage): void {
        if (message.type === "navigate") {
            this.currentRoute = message.route;
        }
        this.webviewPanel.webview.postMessage(message);
    }

    private receiveMessage(message: WebviewMessage) {
        switch (message.type) {
            case "ready":
                this.postMessage({ type: "navigate", route: this.currentRoute });
                break;
            case "rendered":
                this.currentRoute = message.route;
                break;
        }
    }

    private activeTextEditorChanged(editor: vscode.TextEditor | undefined) {
        this.findRouteFromTextDocument(editor).then(navigateToPath => {
            if (!navigateToPath) {
                return;
            }

            this.postMessage({ type: "navigate", route: navigateToPath });
        });
    }

    private textEditorSelectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
        this.findRouteFromTextDocument(event.textEditor).then(navigateToPath => {
            if (!navigateToPath) {
                return;
            }

            this.postMessage({ type: "navigate", route: navigateToPath });
        });
    }

    private async findRouteFromTextDocument(
        editor: vscode.TextEditor | undefined
    ): Promise<string | undefined> {
        const document = editor?.document;
        if (!document || document.uri.scheme !== "file") {
            return undefined;
        }

        const target = findTargetForFile(document.uri.fsPath, this.context);
        if (target?.type !== "executable" && target?.type !== "library") {
            return;
        }

        const targetRoute = `/documentation/${target.name}`;
        if (
            document.uri.fsPath.endsWith(".md") &&
            (await fileExists(
                this.archivePath,
                "data",
                "documentation",
                target.name.toLocaleLowerCase(),
                path.basename(document.uri.fsPath, ".md") + ".json"
            ))
        ) {
            return targetRoute + "/" + path.basename(document.uri.fsPath, ".md");
        } else if (document.uri.fsPath.endsWith(".tutorial")) {
            return `/tutorials/${target.name}/${path.basename(document.uri.fsPath, ".tutorial").replaceAll(" ", "-")}`;
        } else if (document.languageId === "swift") {
            const symbolRoute = await this.findSymbolInDocument(document, editor.selection);
            if (symbolRoute) {
                return targetRoute + "/" + symbolRoute;
            }
        }
        return undefined;
    }

    private async findSymbolInDocument(
        document: vscode.TextDocument,
        range: vscode.Range
    ): Promise<string | undefined> {
        const symbols: vscode.DocumentSymbol[] = (
            await vscode.commands.executeCommand<
                (vscode.SymbolInformation | vscode.DocumentSymbol)[]
            >("vscode.executeDocumentSymbolProvider", document.uri)
        ).filter((sym): sym is vscode.DocumentSymbol => "children" in sym);

        const symbol = findDocumentableSymbolAtPosition(symbols, range.start);
        if (!symbol) {
            return undefined;
        }
        const symbolRoute = convertSymbolToDocumentationRoute(symbol, symbols);
        // Older versions of SourceKit-LSP don't include parameter information for constructors
        // in the document symbol name. Use a SymbolInfoRequest to grab this information.
        const response = await this.context.languageClientManager.useLanguageClient(
            async client => {
                return await client.sendRequest(SymbolInfoRequest.type, {
                    textDocument: {
                        uri: document.uri.toString(),
                    },
                    position: symbol.selectionRange.start,
                });
            }
        );
        const symbolDetails = response.at(0);
        if (!symbolDetails || !symbolDetails.name) {
            return symbolRoute;
        }
        return path.join(symbolRoute, "..", symbolDetails.name);
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
