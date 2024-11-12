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

import { RenderNode, WebviewMessage } from "./WebviewMessage";
import { createCommunicationBridge } from "./CommunicationBridge";

createCommunicationBridge().then(async bridge => {
    const vscode = acquireVsCodeApi();
    let activeDocumentationPath: string | undefined;
    let contentToApplyOnRender: RenderNode | undefined;

    // Handle messages coming from swift-docc-render
    bridge.onDidReceiveMessage(message => {
        switch (message.type) {
            case "rendered":
                if (contentToApplyOnRender) {
                    setTimeout(() => {
                        bridge.send({ type: "contentUpdate", data: contentToApplyOnRender });
                        contentToApplyOnRender = undefined;
                    }, 1);
                    break;
                }
                vscode.postMessage({ type: "rendered" });
                break;
        }
    });

    // Handle messages coming from vscode-swift
    window.addEventListener("message", event => {
        if (typeof event.data !== "object" || !("type" in event.data)) {
            return;
        }

        const message = event.data as WebviewMessage;
        switch (message.type) {
            case "update-content":
                handleUpdateContentMessage(message.content);
                break;
        }
    });
    function handleUpdateContentMessage(renderNode: RenderNode) {
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
