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
/* eslint-disable @typescript-eslint/no-floating-promises */
import { createCommunicationBridge } from "./CommunicationBridge";
import { ErrorMessage } from "./ErrorMessage";
import { ThemeObserver } from "./ThemeObserver";
import { RenderNode, WebviewContent, WebviewMessage } from "./WebviewMessage";

// Remove VS Code's default styles as they conflict with swift-docc-render
document.getElementById("_defaultStyles")?.remove();

// Hook up the automatic theme switching
const themeObserver = new ThemeObserver();
themeObserver.updateTheme();
themeObserver.start();

// Disable clicking on links as they do not work
const disableLinks = document.createElement("style");
disableLinks.textContent = `a {
    pointer-events: none;
}`;
document.head.appendChild(disableLinks);

// Set up the communication bridges to VS Code and swift-docc-render
createCommunicationBridge().then(async bridge => {
    const vscode = acquireVsCodeApi();
    let activeDocumentationPath: string | undefined;
    let contentToApplyOnRender: RenderNode | undefined;

    // An HTML element that displays an error message to the user
    const errorMessage = new ErrorMessage();

    // Handle messages coming from swift-docc-render
    bridge.onDidReceiveMessage(message => {
        if (message.type === "rendered") {
            if (contentToApplyOnRender) {
                setTimeout(() => {
                    bridge.send({ type: "contentUpdate", data: contentToApplyOnRender });
                    contentToApplyOnRender = undefined;
                }, 1);
            } else {
                vscode.postMessage({ type: "rendered" });
            }
        }
    });

    // Handle messages coming from vscode-swift
    // eslint-disable-next-line sonarjs/post-message
    window.addEventListener("message", event => {
        if (typeof event.data !== "object" || !("type" in event.data)) {
            return;
        }

        const message = event.data as WebviewMessage;
        if (message.type === "update-content") {
            handleUpdateContentMessage(message.content);
        }
    });
    function handleUpdateContentMessage(content: WebviewContent) {
        if (content.type === "render-node") {
            hideErrorMessage();
            const renderNode = content.renderNode;
            const documentationPath: string = (() => {
                switch (renderNode.kind) {
                    case "symbol":
                    case "article":
                        return "/live/documentation";
                    case "overview":
                        return "/live/tutorials-overview";
                    default:
                        return "/live/tutorials";
                }
            })();
            if (activeDocumentationPath !== documentationPath) {
                activeDocumentationPath = documentationPath;
                contentToApplyOnRender = renderNode;
                bridge.send({
                    type: "navigation",
                    data: documentationPath,
                });
            } else {
                bridge.send({ type: "contentUpdate", data: renderNode });
            }
        } else {
            showErrorMessage(content.errorMessage);
            vscode.postMessage({ type: "rendered" });
        }
    }

    function showErrorMessage(message: string) {
        const app = window.document.getElementById("app");
        if (app) {
            app.style.display = "none";
        }
        errorMessage.show(message);
    }

    function hideErrorMessage() {
        const app = window.document.getElementById("app");
        if (app) {
            app.style.display = "block";
        }
        errorMessage.hide();
    }

    // Notify vscode-swift that we're ready to receive messages
    vscode.postMessage({ type: "loaded" });
});

declare global {
    /**
     * An API provided by VS Code used to retrieve/store state and communicate with
     * the extension that created this WebView.
     */
    interface VSCodeWebviewAPI {
        /**
         * Get the current state of this WebView.
         *
         * Used in combination with {@link setState} to retain state even if this WebView is hidden.
         *
         * @returns the current value of the state
         */
        getState(): unknown | undefined;

        /**
         * Set the current state of this Webview.
         *
         * Used in combination with {@link getState} to retain state even if this WebView is hidden.
         *
         * @param value the current value of the state
         */
        setState(value: unknown): void;

        /**
         * Send an event to the extension that created this WebView.
         *
         * @param event the {@link WebviewMessage} that will be sent
         */
        postMessage(event: WebviewMessage): void;
    }

    /**
     * Get the {@link VSCodeWebviewAPI} provided to this WebView by VS Code.
     */
    function acquireVsCodeApi(): VSCodeWebviewAPI;
}
