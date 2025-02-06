//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { LaunchConfigType } from "./debugAdapter";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";

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

interface OutputEventBody {
    category: string;
    output: string;
}

interface DebugMessage {
    seq: number;
    type: string;
    event: string;
    body: OutputEventBody;
}

/**
 * Register the LoggingDebugAdapterTrackerFactory with the VS Code debug adapter tracker
 * @returns A disposable to be disposed when the extension is deactivated
 */
export function registerLoggingDebugAdapterTracker(): vscode.Disposable {
    // Register the factory for both lldb-dap and CodeLLDB since either could be used when
    // resolving a Swift launch configuration.
    const trackerFactory = new LoggingDebugAdapterTrackerFactory();
    const subscriptions: vscode.Disposable[] = [
        vscode.debug.registerDebugAdapterTrackerFactory(LaunchConfigType.CODE_LLDB, trackerFactory),
        vscode.debug.registerDebugAdapterTrackerFactory(LaunchConfigType.LLDB_DAP, trackerFactory),
    ];

    // Return a disposable that cleans everything up.
    return {
        dispose() {
            subscriptions.forEach(sub => sub.dispose());
        },
    };
}

/**
 * Debug Adapter tracker that tracks debugger output to stdout and stderr and returns it
 */
export class LoggingDebugAdapterTracker implements vscode.DebugAdapterTracker {
    // keep a track of the logging debug trackers, so we can set the callback later on
    private static debugSessionIdMap: { [id: string]: LoggingDebugAdapterTracker } = {};

    private cb?: (output: string) => void;

    constructor(public id: string) {
        LoggingDebugAdapterTracker.debugSessionIdMap[id] = this;
    }

    static setDebugSessionCallback(
        session: vscode.DebugSession,
        outputChannel: SwiftOutputChannel,
        cb: (log: string) => void
    ) {
        const loggingDebugAdapter = this.debugSessionIdMap[session.id];
        if (loggingDebugAdapter) {
            loggingDebugAdapter.cb = cb;
        } else {
            outputChannel.appendLine("Could not find debug adapter for session: " + session.id);
        }
    }

    /**
     * The debug adapter has sent a Debug Adapter Protocol message to the editor. Check
     * it is a output message and is not being sent to the console
     */
    onDidSendMessage(message: unknown): void {
        const debugMessage = message as DebugMessage;
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
