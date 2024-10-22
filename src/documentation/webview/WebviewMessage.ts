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

/**
 * Represents a message that can be sent between the webview and vscode-swift
 */
export type WebviewMessage = ReadyMessage | NavigateMessage | RenderMessage | UpdateContentMessage;

/**
 * Sent from the webview to the extension to indicate that the webview is
 * ready to receive messages.
 */
export interface ReadyMessage {
    type: "ready";
}

/**
 * Sent from the extension to the webview after the "ready" message is
 * received in order to navigate to a particular documentation page.
 */
export interface NavigateMessage {
    type: "navigate";
    route: string;
}

/**
 * Sent from the webview to the extension to indicate that content has been
 * rendered to the screen.
 */
export interface RenderMessage {
    type: "rendered";
    route: string;
}

/**
 * Sent from the extension to the webview to update its contents. The data
 * format is the same as DocC's JSON index.
 *
 * This must be sent AFTER the webview has done at least one render.
 */
export interface UpdateContentMessage {
    type: "update-content";
    data: unknown;
}
