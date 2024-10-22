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
import { Ready, WebviewState } from "./WebviewState";
import { WebviewEvent } from "./WebviewEvent";
import { createCommunicationBridge, CommunicationBridge } from "./CommunicationBridge";
import { Disposable } from "./Disposable";

createCommunicationBridge().then(async bridge => {
    const vscode = acquireVsCodeApi();
    let state: WebviewState = vscode.getState() ?? { type: "waiting-for-vscode" };

    // Restore the previous state (if any) before we do anything
    if (state.type === "ready") {
        await restoreState(bridge, state);
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
                // the "navigation" event only works once in VS Code
                if (state.type !== "waiting-for-vscode") {
                    break;
                }

                state = {
                    type: "ready",
                    initialRoute: event.route,
                    scrollPosition: { x: 0, y: 0 },
                };
                bridge.send({ type: "navigation", data: event.route });
                break;
            case "update-content":
                if (state.type !== "ready") {
                    break;
                }

                state.pageContent = event.data;
                if (event.scrollTo) {
                    state.scrollPosition = event.scrollTo;
                    window.scrollTo({ left: event.scrollTo.x, top: event.scrollTo.y });
                }
                vscode.setState(state);
                bridge.send({ type: "contentUpdate", data: event.data });
                break;
        }
    });

    // Store the current scroll state so that we can restore it if we lose focus
    window.addEventListener(
        "scroll",
        debounce(() => {
            if (state.type !== "ready") {
                return;
            }

            state.scrollPosition = {
                x: window.scrollX,
                y: window.scrollY,
            };
            vscode.setState(state);
        }, 200)
    );

    // Notify vscode-swift that we're ready to receive events only once. Losses of focus
    // and their resulting state restorations should not send a "ready" event.
    if (state.type === "waiting-for-vscode") {
        vscode.postMessage({ type: "ready" });
    }
});

async function restoreState(bridge: CommunicationBridge, state: Ready): Promise<void> {
    const subcriptions: Disposable[] = [];
    try {
        bridge.send({ type: "navigation", data: state.initialRoute });
        await waitForNextRender(bridge);
        if (state.pageContent !== undefined) {
            bridge.send({ type: "contentUpdate", data: state.pageContent });
            await waitForNextRender(bridge);
        }
        window.scrollTo({ left: state.scrollPosition.x, top: state.scrollPosition.y });
    } finally {
        subcriptions.forEach(subscription => subscription.dispose());
    }
}

async function waitForNextRender(bridge: CommunicationBridge): Promise<void> {
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
        });
    } finally {
        subcriptions.forEach(subscription => subscription.dispose());
    }
}
