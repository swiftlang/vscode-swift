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

export type VueAppEvent = RenderedEvent | NavigationEvent | UpdateContentEvent;

export interface RenderedEvent {
    type: "rendered";
}

export interface NavigationEvent {
    type: "navigation";
    data: string;
}

export interface UpdateContentEvent {
    type: "contentUpdate";
    data: unknown;
}

export interface CommunicationBridge {
    send(event: VueAppEvent): void;
    onDidReceiveEvent(handler: (event: VueAppEvent) => void): Disposable;
}

export function acquireCommunicationBridge(): Promise<CommunicationBridge> {
    if ("webkit" in window) {
        throw new Error("CommunicationBridge has already been established");
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
