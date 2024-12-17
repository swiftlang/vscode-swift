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
 * Automatically removes any other loading/error messages.
 *
 * This must be sent AFTER the webview has done at least one render.
 */
export interface UpdateContentMessage {
    type: "update-content";
    content: WebviewContent;
}

export type WebviewContent = RenderNodeContent | ErrorContent;

export interface RenderNodeContent {
    type: "render-node";
    renderNode: RenderNode;
}

export interface ErrorContent {
    type: "error";
    errorMessage: string;
}

/**
 * A Swift DocC render node that represents a single page of documentation.
 *
 * In order to maintain maximum compatibility this interface only exposes the bare minimum
 * that we need to support live preview. This interface must be kept up to date with
 * https://github.com/swiftlang/swift-docc/blob/main/Sources/SwiftDocC/Model/Rendering/RenderNode.swift
 */
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
