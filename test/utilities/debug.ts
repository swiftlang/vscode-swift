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
import { DebugProtocol } from "@vscode/debugprotocol";
import { Workbench } from "@src/utilities/commands";
import { DebugAdapter } from "@src/debugger/debugAdapter";
import { Version } from "@src/utilities/version";

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
export async function waitForDebugAdapterMessage<T extends DebugProtocol.ProtocolMessage>(
    name: string,
    version: Version,
    matches: (message: T) => boolean
): Promise<T> {
    return await new Promise<T>(res => {
        const disposable = vscode.debug.registerDebugAdapterTrackerFactory(
            DebugAdapter.getLaunchConfigType(version),
            {
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
            }
        );
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
export async function waitForDebugAdapterRequest(
    name: string,
    version: Version,
    command: string
): Promise<DebugProtocol.Request> {
    return await waitForDebugAdapterMessage(
        name,
        version,
        (m: DebugProtocol.Request) => m.command === command
    );
}

/**
 * Waits for a specific event to be sent by the debug adapter.
 *
 * @param name The name of the debug session to wait for.
 * @param command The command to wait for.
 * @param workspaceContext The workspace context containing toolchain information.
 * @returns A promise that resolves with the matching command event.
 */
export async function waitForDebugAdapterEvent(
    name: string,
    version: Version,
    event: string
): Promise<DebugProtocol.Event> {
    return await waitForDebugAdapterMessage(
        name,
        version,
        (m: DebugProtocol.Event) => m.event === event
    );
}

/**
 * Waits for a debug adapter for the specified DebugSession name to terminate.
 *
 * @param name The name of the debug session to wait for.
 * @returns exit code of the DAP
 */
export async function waitForDebugAdapterExit(name: string, version: Version): Promise<number> {
    const message = await waitForDebugAdapterEvent(name, version, "exited");
    return message.body.exitCode;
}
