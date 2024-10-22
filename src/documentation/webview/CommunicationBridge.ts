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

import { Disposable } from "./Disposable";

/**
 * Sends and receives messages from swift-docc-render
 */
export interface CommunicationBridge {
    send(message: VueAppMessage): void;
    onDidReceiveMessage(handler: (message: VueAppMessage) => void): Disposable;
}

/**
 * Creates a {@link CommunicationBridge} that can send and receive messages from
 * swift-docc-render.
 *
 * Waits for swift-docc-render to be initialized before resolving.
 *
 * @returns A promise that resolves to the created CommunicationBridge
 */
export function createCommunicationBridge(): Promise<CommunicationBridge> {
    if ("webkit" in window) {
        throw new Error("A CommunicationBridge has already been established");
    }

    return new Promise<CommunicationBridge>((resolve, reject) => {
        try {
            // Define the window.webkit property in order to receive messages
            const messageHandlers: Set<(message: VueAppMessage) => void> = new Set();
            Object.defineProperty(window, "webkit", {
                value: {
                    messageHandlers: {
                        bridge: {
                            postMessage(message: VueAppMessage) {
                                messageHandlers.forEach(handler => handler(message));
                            },
                        },
                    },
                },
                writable: false,
            });

            // Wait for the window.bridge property to be set in order to send messages
            let windowBridge: unknown;
            Object.defineProperty(window, "bridge", {
                get() {
                    return windowBridge;
                },
                set(value) {
                    windowBridge = value;
                    resolve({
                        send(message) {
                            value.receive(message);
                        },
                        onDidReceiveMessage(handler): Disposable {
                            messageHandlers.add(handler);
                            return {
                                dispose() {
                                    messageHandlers.delete(handler);
                                },
                            };
                        },
                    });
                },
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Represents a message that can be sent between the webview and swift-docc-render
 */
export type VueAppMessage = RenderedMessage | NavigationMessage | UpdateContentMessage;

/**
 * Sent from swift-docc-render to the webview when content as been rendered
 * to the screen.
 */
export interface RenderedMessage {
    type: "rendered";
    data: {
        time?: number;
        route: string;
    };
}

/**
 * Sent from the webview to swift-docc-render to navigate to a given page.
 *
 * This will only work once due to limitations in VS Code WebViews. You will
 * need to send an {@link UpdateContentMessage} after the first render to
 * switch pages.
 */
export interface NavigationMessage {
    type: "navigation";
    data: string;
}

/**
 * Sent from the webview to swift-docc-render to update the page content.
 *
 * The data comes from the JSON files found in the "data" subdirectory
 * of the documentation archive. This must first be parsed into a
 * JavaScript object before sending. Raw strings will not be parsed
 * automatically.
 */
export interface UpdateContentMessage {
    type: "contentUpdate";
    data: unknown;
}
