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
import { ExecFileOptions } from "child_process";
import * as path from "path";
import * as Stream from "stream";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WithAskpassServerOptions, withAskpassServer } from "../askpass/askpass-server";
import { execFile, execFileStreamOutput } from "./utilities";

export class SudoService {
    constructor(private readonly extensionRoot: string) {}

    public execFile(
        executable: string,
        args: string[],
        askPassOptions: WithAskpassServerOptions = {},
        execOptions: ExecFileOptions = {},
        folderContext?: FolderContext,
        customSwiftRuntime = true
    ): Promise<{ stdout: string; stderr: string }> {
        return withAskpassServer(
            (nonce, port) =>
                execFile(
                    "sudo",
                    ["-A", executable, ...args],
                    {
                        ...execOptions,
                        env: {
                            ...process.env,
                            SUDO_ASKPASS: path.join(this.extensionRoot, "assets/swift_askpass.sh"),
                            VSCODE_SWIFT_ASKPASS_NODE: process.execPath,
                            VSCODE_SWIFT_ASKPASS_MAIN: path.join(
                                this.extensionRoot,
                                "dist/src/askpass/askpass-main.js"
                            ),
                            VSCODE_SWIFT_ASKPASS_NONCE: nonce,
                            VSCODE_SWIFT_ASKPASS_PORT: port.toString(10),
                        },
                    },
                    folderContext,
                    customSwiftRuntime
                ),
            askPassOptions
        );
    }

    public async execFileStreamOutput(
        executable: string,
        args: string[],
        stdout: Stream.Writable | null,
        stderr: Stream.Writable | null,
        token: vscode.CancellationToken | null,
        askPassOptions: WithAskpassServerOptions = {},
        execOptions: ExecFileOptions = {},
        folderContext?: FolderContext,
        customSwiftRuntime = true,
        killSignal: NodeJS.Signals = "SIGTERM"
    ): Promise<void> {
        return await withAskpassServer(async (nonce, port) => {
            await execFileStreamOutput(
                "sudo",
                ["-A", executable, ...args],
                stdout,
                stderr,
                token,
                {
                    ...execOptions,
                    env: {
                        ...process.env,
                        SUDO_ASKPASS: path.join(this.extensionRoot, "assets/swift_askpass.sh"),
                        VSCODE_SWIFT_ASKPASS_NODE: process.execPath,
                        VSCODE_SWIFT_ASKPASS_MAIN: path.join(
                            this.extensionRoot,
                            "dist/src/askpass/askpass-main.js"
                        ),
                        VSCODE_SWIFT_ASKPASS_NONCE: nonce,
                        VSCODE_SWIFT_ASKPASS_PORT: port.toString(10),
                    },
                },
                folderContext,
                customSwiftRuntime,
                killSignal
            );
        }, askPassOptions);
    }
}
