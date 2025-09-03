//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
// We use namespaces to store request information just like vscode-languageclient
/* eslint-disable @typescript-eslint/no-namespace */
import { LogMessageParams, MessageDirection, NotificationType } from "vscode-languageclient";

/** Parameters sent in a {@link SourceKitLogMessageNotification}. */
export interface SourceKitLogMessageParams extends LogMessageParams {
    logName?: string;
}

/**
 * The log message notification is sent from the server to the client to ask the client to
 * log a particular message.
 *
 * ### LSP Extension
 *
 * This notification has the same behaviour as the `window/logMessage` notification built
 * into the LSP. However, SourceKit-LSP adds extra information to the parameters.
 */
export namespace SourceKitLogMessageNotification {
    export const method = "window/logMessage" as const;
    export const messageDirection: MessageDirection = MessageDirection.serverToClient;
    export const type = new NotificationType<SourceKitLogMessageParams>(method);
}
