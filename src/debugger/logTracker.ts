//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

/**
 * Factory class for building LoggingDebugAdapterTracker
 */
export class LoggingDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    createDebugAdapterTracker(
        session: vscode.DebugSession
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return new LoggingDebugAdapterTracker(session.id);
    }
}

interface iOutputEventBody {
    category: string;
    output: string;
}

interface iDebugMessage {
    seq: number;
    type: string;
    event: string;
    body: iOutputEventBody;
}

/**
 * Debug Adapter tracker that track debuggee output to stdout and stderr and returns it
 */
export class LoggingDebugAdapterTracker implements vscode.DebugAdapterTracker {
    // keep a track of the logging debug trackers, so we can set the callback later on
    private static debugSessionIdMap: { [id: string]: LoggingDebugAdapterTracker } = {};

    private cb?: (output: string) => void;

    constructor(public id: string) {
        LoggingDebugAdapterTracker.debugSessionIdMap[id] = this;
    }

    static addDebugSessionCallback(session: vscode.DebugSession, cb: (log: string) => void) {
        const loggingDebugAdapter = this.debugSessionIdMap[session.id];
        if (loggingDebugAdapter) {
            loggingDebugAdapter.cb = cb;
        }
    }

    /**
     * The debug adapter has sent a Debug Adapter Protocol message to the editor. Check
     * it is a output message and is not being sent to the console
     */
    onDidSendMessage(message: unknown): void {
        const debugMessage = message as iDebugMessage;
        if (
            this.cb &&
            debugMessage &&
            debugMessage.type === "event" &&
            debugMessage.event === "output" &&
            debugMessage.body.category !== "console"
        ) {
            this.cb(debugMessage.body.output);
        }
    }

    /**
     * The debug adapter session is about to be stopped. Delete the session from
     * the tracker
     */
    onWillStopSession?(): void {
        delete LoggingDebugAdapterTracker.debugSessionIdMap[this.id];
    }
}
