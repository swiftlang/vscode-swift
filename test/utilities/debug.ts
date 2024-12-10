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
import { Workbench } from "../../src/utilities/commands";

export async function continueSession(): Promise<void> {
    await vscode.commands.executeCommand(Workbench.ACTION_DEBUG_CONTINUE);
}

/**
 * Waits for a specific message from the debug adapter.
 *
 * @param name The name of the debug session to wait for.
 * @param matches A function to match the desired message.
 * @param workspaceContext The workspace context containing toolchain information.
 * @returns A promise that resolves with the matching message.
 */
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

/**
 * Waits for a specific debug session to terminate.
 *
 * @param name The name of the debug session to wait for.
 * @returns the terminated DebugSession
 */
export async function waitUntilDebugSessionTerminates(name: string): Promise<vscode.DebugSession> {
    return await new Promise<vscode.DebugSession>(res =>
        vscode.debug.onDidTerminateDebugSession(e => {
            if (e.name === name) {
                res(e);
            }
        })
    );
}

/**
 * Waits for a specific command to be sent by the debug adapter.
 *
 * @param name The name of the debug session to wait for.
 * @param command The command to wait for.
 * @param workspaceContext The workspace context containing toolchain information.
 * @returns A promise that resolves with the matching command message.
 */
export async function waitForDebugAdapterCommand(name: string, command: string): Promise<any> {
    return await waitForDebugAdapterMessage(name, (m: any) => m.command === command);
}

/**
 * Waits for a specific event to be sent by the debug adapter.
 *
 * @param name The name of the debug session to wait for.
 * @param command The command to wait for.
 * @param workspaceContext The workspace context containing toolchain information.
 * @returns A promise that resolves with the matching command event.
 */
export async function waitForDebugAdapterEvent(name: string, event: string): Promise<any> {
    return await waitForDebugAdapterMessage(name, (m: any) => m.event === event);
}

/**
 * Waits for a debug adapter for the specified DebugSession name to terminate.
 *
 * @param name The name of the debug session to wait for.
 * @returns exit code of the DAP
 */
export async function waitForDebugAdapterExit(name: string): Promise<number> {
    return await waitForDebugAdapterEvent(name, "exited").then(m => m.body.exitCode);
}
