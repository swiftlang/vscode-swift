//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

// Based on code taken from CodeLLDB https://github.com/vadimcn/vscode-lldb/
// LICENSED with MIT License

import * as path from "path";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import { WorkspaceContext } from "../WorkspaceContext";
import { execFile, getErrorDescription } from "../utilities/utilities";
import { Result } from "../utilities/result";
import { SwiftToolchain } from "../toolchain/toolchain";

export const CI_DISABLE_ASLR =
    // DisableASLR when running in Docker CI https://stackoverflow.com/a/78471987
    process.env["CI"]
        ? {
              disableASLR: false,
              initCommands: ["settings set target.disable-aslr false"],
          }
        : {};

/**
 * Get LLDB library for given LLDB executable
 * @param executable LLDB executable
 * @returns Library path for LLDB
 */
export async function getLLDBLibPath(toolchain: SwiftToolchain): Promise<Result<string>> {
    let executable: string;
    try {
        executable = await toolchain.getLLDB();
    } catch (error) {
        return Result.makeFailure(error);
    }
    let pathHint = path.dirname(toolchain.swiftFolderPath);
    try {
        const statement = `print('<!' + lldb.SBHostOS.GetLLDBPath(lldb.ePathTypeLLDBShlibDir).fullpath + '!>')`;
        const args = ["-b", "-O", `script ${statement}`];
        const { stdout } = await execFile(executable, args);
        const m = /^<!([^!]*)!>/m.exec(stdout);
        if (m) {
            pathHint = m[1];
        }
    } catch (error) {
        // If we get an error on Windows here we should not attempt to use the fallback path. If it failed
        // it is most likely due to lldb failing to run because $PYHTONHOME environment variable is setup
        // incorrectly (this is the case in Swift < 5.7). In this situation swift lldb does not work so we
        // should just the version of lldb that comes with CodeLLDB. We return a failure with no message
        // to indicate we want it to fail silently.
        if (process.platform === "win32") {
            return Result.makeFailure(undefined);
        }
    }
    const lldbPath = await findLibLLDB(pathHint);
    if (lldbPath) {
        return Result.makeSuccess(lldbPath);
    } else {
        return Result.makeFailure("LLDB failed to provide a library path");
    }
}

export async function findLibLLDB(pathHint: string): Promise<string | undefined> {
    const stat = await fs.stat(pathHint);
    if (stat.isFile()) {
        return pathHint;
    }

    let libDir;
    let pattern;
    if (process.platform === "linux") {
        libDir = path.join(pathHint, "lib");
        pattern = /liblldb.*\.so.*/;
    } else if (process.platform === "darwin") {
        libDir = path.join(pathHint, "lib");
        pattern = /liblldb\..*dylib|LLDB/;
    } else if (process.platform === "win32") {
        libDir = path.join(pathHint, "bin");
        pattern = /liblldb\.dll/;
    } else {
        return pathHint;
    }

    for (const dir of [pathHint, libDir]) {
        const file = await findFileByPattern(dir, pattern);
        if (file) {
            return path.join(dir, file);
        }
    }
    return undefined;
}

export async function findFileByPattern(path: string, pattern: RegExp): Promise<string | null> {
    try {
        const files = await fs.readdir(path);
        for (const file of files) {
            if (pattern.test(file)) {
                return file;
            }
        }
    } catch (err) {
        // Ignore missing directories and such...
    }
    return null;
}

/**
 * Retrieves a list of LLDB processes from the system using LLDB.
 *
 * This function executes an LLDB command to list all processes on the system,
 * including their arguments, and returns them in an array of objects where each
 * object contains the `pid` and a `label` describing the process.
 *
 * @param {WorkspaceContext} ctx - The workspace context, which includes the toolchain needed to run LLDB.
 * @returns {Promise<Array<{ pid: number; label: string }> | undefined>}
 * A promise that resolves to an array of processes, where each process is represented by an object with a `pid` and a `label`.
 * If an error occurs or no processes are found, it returns `undefined`.
 *
 * @throws Will display an error message in VS Code if the LLDB command fails.
 */
export async function getLldbProcess(
    ctx: WorkspaceContext
): Promise<Array<{ pid: number; label: string }> | undefined> {
    try {
        // use LLDB to get list of processes
        const lldb = await ctx.toolchain.getLLDB();
        const { stdout } = await execFile(lldb, [
            "--batch",
            "--no-lldbinit",
            "--one-line",
            "platform process list --show-args --all-users",
        ]);
        const entries = stdout.split("\n");
        const processes = entries.flatMap(line => {
            const match = /^(\d+)\s+\d+\s+\S+\s+\S+\s+(.+)$/.exec(line);
            if (match) {
                return [{ pid: parseInt(match[1]), label: `${match[1]}: ${match[2]}` }];
            } else {
                return [];
            }
        });
        return processes;
    } catch (error) {
        const errorMessage = `Failed to run LLDB: ${getErrorDescription(error)}`;
        ctx.outputChannel.log(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
    }
}
