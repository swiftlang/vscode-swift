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

import { SwiftLogger } from "../logging/SwiftLogger";
import { LaunchConfigType } from "./debugAdapter";

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
    exitCode: number | undefined;
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
    private exitHandler?: (exitCode: number) => void;
    private output: string[] = [];
    private exitCode: number | undefined;

    constructor(public id: string) {
        LoggingDebugAdapterTracker.debugSessionIdMap[id] = this;
    }

    static setDebugSessionCallback(
        session: vscode.DebugSession,
        logger: SwiftLogger,
        cb: (log: string) => void,
        exitHandler: (exitCode: number) => void
    ) {
        const loggingDebugAdapter = this.debugSessionIdMap[session.id];
        if (loggingDebugAdapter) {
            loggingDebugAdapter.setCallbacks(cb, exitHandler);
            for (const o of loggingDebugAdapter.output) {
                cb(o);
            }
            if (loggingDebugAdapter.exitCode) {
                exitHandler(loggingDebugAdapter.exitCode);
            }
            loggingDebugAdapter.output = [];
            loggingDebugAdapter.exitCode = undefined;
        } else {
            logger.error("Could not find debug adapter for session: " + session.id);
        }
    }

    setCallbacks(handleOutput: (output: string) => void, handleExit: (exitCode: number) => void) {
        this.cb = handleOutput;
        this.exitHandler = handleExit;
    }

    /**
     * The debug adapter has sent a Debug Adapter Protocol message to the editor. Check
     * it is a output message and is not being sent to the console
     */
    onDidSendMessage(message: unknown): void {
        const debugMessage = message as DebugMessage;
        if (!debugMessage) {
            return;
        }

        this.handleBreakpointFallback(debugMessage);

        if (debugMessage.event === "exited" && debugMessage.body.exitCode) {
            this.exitCode = debugMessage.body.exitCode;
            this.exitHandler?.(debugMessage.body.exitCode);
        } else if (
            debugMessage.type === "event" &&
            debugMessage.event === "output" &&
            debugMessage.body.category !== "console"
        ) {
            const output = debugMessage.body.output;
            if (this.cb) {
                this.cb(output);
            } else {
                this.output.push(output);
            }
        }
    }

    private handleBreakpointFallback(rawMsg: unknown): void {
        try {
            // Minimal typed view of the event payload we care about.
            type FrameLike = { source?: { path?: string }; line?: number };
            type BodyLike = {
                exitCode?: number;
                category?: string;
                output?: string;
                reason?: string;
                thread?: { frames?: FrameLike[] };
                source?: { path?: string };
                line?: number;
            };

            const msg = rawMsg as { type?: string; event?: string; body?: BodyLike | undefined };
            if (!msg || msg.type !== "event") {
                return;
            }

            // Case A: stopped event with reason = "breakpoint"
            if (msg.event === "stopped" && msg.body?.reason === "breakpoint") {
                const frames = msg.body.thread?.frames;
                if (!Array.isArray(frames) || frames.length === 0) {
                    return;
                }

                const top = frames[0];
                const sourcePath = top?.source?.path;
                const line = top?.line;
                if (!sourcePath || typeof line !== "number") {
                    return;
                }

                const bpLine0 = line - 1; // VS Code uses 0-based lines

                const breakpoints = vscode.debug.breakpoints.filter(
                    b => b instanceof vscode.SourceBreakpoint
                ) as vscode.SourceBreakpoint[];

                for (const bp of breakpoints) {
                    const loc = bp.location;
                    if (!loc) {
                        continue;
                    }
                    if (loc.uri.fsPath !== sourcePath) {
                        continue;
                    }
                    if (loc.range.start.line !== bpLine0) {
                        continue;
                    }

                    // Force a UI refresh so the breakpoint shows as installed.
                    vscode.debug.removeBreakpoints([bp]);
                    vscode.debug.addBreakpoints([bp]);
                    break;
                }
                return;
            }

            // Case B: explicit "breakpoint" event that carries source+line info
            if (msg.event === "breakpoint" && msg.body) {
                const sourcePath = msg.body.source?.path;
                const line = msg.body.line;
                if (!sourcePath || typeof line !== "number") {
                    return;
                }

                const bpLine0 = line - 1;
                const breakpoints = vscode.debug.breakpoints.filter(
                    b => b instanceof vscode.SourceBreakpoint
                ) as vscode.SourceBreakpoint[];

                for (const bp of breakpoints) {
                    const loc = bp.location;
                    if (!loc) {
                        continue;
                    }
                    if (loc.uri.fsPath !== sourcePath) {
                        continue;
                    }
                    if (loc.range.start.line !== bpLine0) {
                        continue;
                    }

                    vscode.debug.removeBreakpoints([bp]);
                    vscode.debug.addBreakpoints([bp]);
                    break;
                }
                return;
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error("Breakpoint fallback error:", err);
        }
    }

    /**
     * The debug adapter session is about to be stopped. Delete the session from
     * the tracker
     */
    onWillStopSession(): void {
        delete LoggingDebugAdapterTracker.debugSessionIdMap[this.id];
    }
}
