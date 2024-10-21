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
import { WebviewState } from "./state";
import { WebviewEvent } from "./events";
import { acquireCommunicationBridge, CommunicationBridge } from "./CommunicationBridge";
import { Disposable } from "./disposable";

async function restoreState(bridge: CommunicationBridge, state: WebviewState): Promise<void> {
    if (state.location === undefined) {
        return;
    }

    const subcriptions: Disposable[] = [];
    try {
        await new Promise<void>(resolve => {
            subcriptions.push(
                bridge.onDidReceiveEvent(event => {
                    switch (event.type) {
                        case "rendered":
                            resolve();
                            break;
                    }
                })
            );
            bridge.send({ type: "navigation", data: state.location! });
        });
        window.scrollTo({ left: state.scrollPosition.x, top: state.scrollPosition.y });
    } finally {
        subcriptions.forEach(subscription => subscription.dispose());
    }
}

acquireCommunicationBridge().then(async bridge => {
    const vscode = acquireVsCodeApi();
    const previousState = vscode.getState();
    const state: WebviewState = previousState ?? {
        scrollPosition: { x: 0, y: 0 },
    };

    // Restore the previous state before we do anything
    if (previousState) {
        await restoreState(bridge, previousState);
    }

    // Handle events coming from swift-docc-render
    bridge.onDidReceiveEvent(event => {
        switch (event.type) {
            case "rendered":
                vscode.postMessage({ type: "rendered" });
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
            case "initialize":
                bridge.send({ type: "navigation", data: event.route });
                state.location = event.route;
                vscode.setState(state);
                break;
            case "update-content":
                bridge.send({ type: "contentUpdate", data: event.data });
        }
    });

    // Store the current scroll state so that we can restore it later
    window.addEventListener(
        "scroll",
        debounce(() => {
            state.scrollPosition = {
                x: window.scrollX,
                y: window.scrollY,
            };
            vscode.setState(state);
        }, 200)
    );

    if (state.location !== undefined) {
        // Restore the page to it's original state
        bridge.send({ type: "navigation", data: state.location });
    } else {
        // Notify vscode-swift that we're ready to receive events
        vscode.postMessage({ type: "ready" });
    }
});
