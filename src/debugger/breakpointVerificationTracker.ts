//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { DebugProtocol } from "@vscode/debugprotocol";
import * as vscode from "vscode";

import { Disposable } from "../utilities/Disposable";
import { LaunchConfigType } from "./debugAdapter";

/**
 * Works around a bug in lldb-dap where source breakpoints set before process
 * launch are never marked as verified, even after the process loads and the
 * breakpoints resolve internally.
 *
 * When a breakpoint is hit, it queries the debug session for each source
 * breakpoint's verified state. Any breakpoints the adapter still reports as
 * unverified are removed and re-added, which causes VS Code to attempt to
 * resolve them again.
 */
export class BreakpointVerificationTracker implements vscode.DebugAdapterTracker {
    private hasRefreshed = false;

    constructor(private readonly session: vscode.DebugSession) {}

    onDidSendMessage(message: DebugProtocol.ProtocolMessage): void {
        void this.onDidSendMessageAsync(message);
    }

    // Exposed for testing purposes.
    async onDidSendMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
        if (this.hasRefreshed) {
            return;
        }
        if (
            isDAPEvent(message) &&
            isStoppedEvent(message) &&
            message.body.reason === "breakpoint"
        ) {
            this.hasRefreshed = true;
            await this.refreshUnverifiedBreakpoints();
        }
    }

    private async refreshUnverifiedBreakpoints(): Promise<void> {
        const breakpointsToRefresh: vscode.SourceBreakpoint[] = await this.getSourceBreakpoints(
            async bp => {
                const dapBp = await this.session.getDebugProtocolBreakpoint(bp);
                return Boolean(dapBp && !isBreakpointVerified(dapBp));
            }
        );
        if (breakpointsToRefresh.length === 0) {
            return;
        }
        vscode.debug.removeBreakpoints(breakpointsToRefresh);
        vscode.debug.addBreakpoints(breakpointsToRefresh);
    }

    private async getSourceBreakpoints(
        predicate: (bp: vscode.SourceBreakpoint) => Promise<boolean>
    ): Promise<vscode.SourceBreakpoint[]> {
        const allSourceBreakpoints = vscode.debug.breakpoints.filter(isSourceBreakpoint);
        const filteredSourceBreakpoints: vscode.SourceBreakpoint[] = [];
        for (const bp of allSourceBreakpoints) {
            if (!(await predicate(bp))) {
                continue;
            }
            filteredSourceBreakpoints.push(bp);
        }
        return filteredSourceBreakpoints;
    }
}

class BreakpointVerificationTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    createDebugAdapterTracker(
        session: vscode.DebugSession
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return new BreakpointVerificationTracker(session);
    }
}

export function registerBreakpointVerificationTracker(): Disposable {
    return vscode.debug.registerDebugAdapterTrackerFactory(
        LaunchConfigType.LLDB_DAP,
        new BreakpointVerificationTrackerFactory()
    );
}

function isDAPEvent(message: DebugProtocol.ProtocolMessage): message is DebugProtocol.Event {
    return message.type === "event";
}

function isStoppedEvent(event: DebugProtocol.Event): event is DebugProtocol.StoppedEvent {
    return event.event === "stopped";
}

function isSourceBreakpoint(bp: vscode.Breakpoint): bp is vscode.SourceBreakpoint {
    return bp instanceof vscode.SourceBreakpoint;
}

function isBreakpointVerified(bp: vscode.DebugProtocolBreakpoint): boolean {
    return "verified" in bp && typeof bp.verified === "boolean" && bp.verified;
}
