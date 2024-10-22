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
import { WebviewEvent } from "./WebviewEvent";
import { createCommunicationBridge } from "./CommunicationBridge";

createCommunicationBridge().then(async bridge => {
    const vscode = acquireVsCodeApi();
    const state: WebviewState = vscode.getState() ?? {};

    // Handle events coming from swift-docc-render
    bridge.onDidReceiveEvent(event => {
        switch (event.type) {
            case "rendered":
                if (state.scrollPosition?.route === event.data.route) {
                    window.scrollTo({ left: state.scrollPosition.x, top: state.scrollPosition.y });
                } else {
                    window.scrollTo({ left: 0, top: 0 });
                    state.scrollPosition = {
                        route: event.data.route,
                        x: 0,
                        y: 0,
                    };
                    vscode.setState(state);
                }
                vscode.postMessage({ type: "rendered", route: event.data.route });
                break;
        }
    });

    // Handle events coming from vscode-swift
    window.addEventListener("message", message => {
        if (typeof message.data !== "object" || !("type" in message.data)) {
            return;
        }

        const event = message.data as WebviewEvent;
        switch (event.type) {
            case "navigate":
                bridge.send({ type: "navigation", data: event.route });
                break;
            case "update-content":
                bridge.send({ type: "contentUpdate", data: event.data });
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

    // Notify vscode-swift that we're ready to receive events
    vscode.postMessage({ type: "ready" });
});
