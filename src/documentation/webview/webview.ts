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

import debounce from "lodash.debounce";
import { WebviewState } from "./WebviewState";
import { WebviewMessage } from "./WebviewMessage";
import { createCommunicationBridge } from "./CommunicationBridge";

createCommunicationBridge().then(async bridge => {
    const vscode = acquireVsCodeApi();
    const state: WebviewState = vscode.getState() ?? {};

    // Handle messages coming from swift-docc-render
    bridge.onDidReceiveMessage(message => {
        switch (message.type) {
            case "rendered":
                if (state.scrollPosition?.route === message.data.route) {
                    window.scrollTo({ left: state.scrollPosition.x, top: state.scrollPosition.y });
                } else {
                    window.scrollTo({ left: 0, top: 0 });
                    state.scrollPosition = {
                        route: message.data.route,
                        x: 0,
                        y: 0,
                    };
                    vscode.setState(state);
                }
                vscode.postMessage({ type: "rendered", route: message.data.route });
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
            case "navigate":
                bridge.send({ type: "navigation", data: message.route });
                break;
            case "update-content":
                bridge.send({ type: "contentUpdate", data: message.data });
                break;
        }
    });

    // Store the current scroll state so that we can restore it if we lose focus
    window.addEventListener(
        "scroll",
        debounce(() => {
            if (!state.scrollPosition) {
                return;
            }

            state.scrollPosition.x = window.scrollX;
            state.scrollPosition.y = window.scrollY;
            vscode.setState(state);
        }, 200)
    );

    // Notify vscode-swift that we're ready to receive messages
    vscode.postMessage({ type: "ready" });
});
