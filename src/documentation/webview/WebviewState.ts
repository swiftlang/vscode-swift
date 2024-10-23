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

import { WebviewMessage } from "./WebviewMessage";

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
         * @returns the current value of the {@link WebviewState}
         */
        getState(): WebviewState | undefined;

        /**
         * Set the current state of this Webview.
         *
         * Used in combination with {@link getState} to retain state even if this WebView is hidden.
         *
         * @param value the current value of the {@link WebviewState}
         */
        setState(value: WebviewState): void;

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

/**
 * Represents the current state of the WebView that is saved  and restored when the Webview is hidden.
 */
export interface WebviewState {
    scrollPosition?: {
        route: string;
        x: number;
        y: number;
    };
}
