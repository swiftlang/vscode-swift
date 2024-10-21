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

import { Disposable } from "./disposable";

/**
 * Sends and receives events from swift-docc-render
 */
export interface CommunicationBridge {
    send(event: VueAppEvent): void;
    onDidReceiveEvent(handler: (event: VueAppEvent) => void): Disposable;
}

/**
 * Creates a {@link CommunicationBridge} that can send and receive events from
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
            // Define the window.webkit property in order to receive events
            const messageHandlers: Set<(event: VueAppEvent) => void> = new Set();
            Object.defineProperty(window, "webkit", {
                value: {
                    messageHandlers: {
                        bridge: {
                            postMessage(event: VueAppEvent) {
                                messageHandlers.forEach(handler => handler(event));
                            },
                        },
                    },
                },
                writable: false,
            });

            // Wait for the window.bridge property to be set in order to send events
            let windowBridge: unknown;
            Object.defineProperty(window, "bridge", {
                get() {
                    return windowBridge;
                },
                set(value) {
                    windowBridge = value;
                    resolve({
                        send(event) {
                            value.receive(event);
                        },
                        onDidReceiveEvent(handler): Disposable {
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
 * Represents an event that can be sent between the webview and swift-docc-render
 */
export type VueAppEvent = RenderedEvent | NavigationEvent | UpdateContentEvent;

/**
 * Sent from swift-docc-render to the webview when content as been rendered
 * to the screen.
 */
export interface RenderedEvent {
    type: "rendered";
}

/**
 * Sent from the webview to swift-docc-render to navigate to a given page.
 *
 * This will only work once due to limitations in VS Code WebViews. You will
 * need to send an {@link UpdateContentEvent} after the first render to
 * switch pages.
 */
export interface NavigationEvent {
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
export interface UpdateContentEvent {
    type: "contentUpdate";
    data: unknown;
}
