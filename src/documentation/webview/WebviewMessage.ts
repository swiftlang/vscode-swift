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
export type WebviewMessage = LoadedMessage | RenderedMessage | UpdateContentMessage;

/**
 * Sent from the webview to the extension to indicate that the webview has loaded
 * and is ready to receive messages.
 */
export interface LoadedMessage {
    type: "loaded";
}

/**
 * Sent from the webview to the extension to indicate that content has been
 * rendered to the screen.
 */
export interface RenderedMessage {
    type: "rendered";
}

/**
 * Sent from the extension to the webview to update its contents. The data
 * format is the same as DocC's JSON index.
 *
 * This must be sent AFTER the webview has done at least one render.
 */
export interface UpdateContentMessage {
    type: "update-content";
    content: RenderNode;
}

export interface RenderNode {
    schemaVersion: {
        major: number;
        minor: number;
        patch: number;
    };

    kind: "symbol" | "article" | "tutorial" | "project" | "section" | "overview";

    identifier: {
        url: string;
        interfacedLanguage: string;
    };

    references: {
        [key: string]: {
            variants?: {
                url: string;
            }[];
        };
    };
}
