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
import * as vscode from "vscode";

export async function continueSession(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.debug.continue");
}

export async function waitUntilDebugSessionTerminates(name: string): Promise<vscode.DebugSession> {
    return await new Promise<vscode.DebugSession>(res =>
        vscode.debug.onDidTerminateDebugSession(e => {
            if (e.name === name) {
                res(e);
            }
        })
    );
}

export async function waitForDebugAdapterMessage(
    name: string,
    matches: (message: any) => boolean
): Promise<any> {
    return await new Promise<any>(res => {
        const disposable = vscode.debug.registerDebugAdapterTrackerFactory("swift-lldb", {
            createDebugAdapterTracker: function (
                session: vscode.DebugSession
            ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
                if (session.name !== name) {
                    return;
                }
                return {
                    onDidSendMessage(message) {
                        if (matches(message)) {
                            disposable.dispose();
                            res(message);
                        }
                    },
                };
            },
        });
    });
}

export async function waitForDebugAdapterCommand(name: string, command: string): Promise<any> {
    return await waitForDebugAdapterMessage(name, (m: any) => m.command === command);
}

export async function waitForDebugAdapterEvent(name: string, event: string): Promise<any> {
    return await waitForDebugAdapterMessage(name, (m: any) => m.event === event);
}

export async function waitForDebugAdapterExit(name: string): Promise<number> {
    return await waitForDebugAdapterEvent(name, "exited").then(m => m.body.exitCode);
}
