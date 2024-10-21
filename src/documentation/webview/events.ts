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

export type WebviewEvent = ReadyEvent | InitializeEvent | RenderEvent | UpdateContentEvent;

/**
 * Sent from the webview to the extension to indicate that the webview is
 * ready to receive events.
 *
 * This will only be sent the first time that the webview is opened. If
 * VS Code already has state for the webview then this will NOT be sent
 * as it implies that the webview has already initialized.
 */
export interface ReadyEvent {
    type: "ready";
}

/**
 * Sent from the extension to the webview after the "ready" event is
 * received in order to set the initial documentation route.
 *
 * This event must only be sent once: subsequent events will be
 * ignored. Use {@link UpdateContentEvent} to render different pages
 * after initialization.
 */
export interface InitializeEvent {
    type: "initialize";
    route: string;
}

/**
 * Sent from the webview to the extension to indicate that content has been
 * rendered to the screen.
 */
export interface RenderEvent {
    type: "rendered";
}

/**
 * Sent from the extension to the webview to update its contents. The data
 * format is the same as DocC's JSON index.
 *
 * This must be sent AFTER the webview has done at least one render.
 */
export interface UpdateContentEvent {
    type: "update-content";
    data: unknown;
}
