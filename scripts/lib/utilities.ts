//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
/* eslint-disable no-console */

import * as child_process from "child_process";

/**
 * Executes the provided main function for the script while logging any errors.
 *
 * If an error is caught then the process will exit with code 1.
 *
 * @param mainFn The main function of the script that will be run.
 */
export async function main(mainFn: () => Promise<void>): Promise<void> {
    try {
        await mainFn();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

/**
 * Executes the given command, inheriting the current process' stdio.
 *
 * @param command The command to execute.
 * @param args The arguments to provide to the command.
 * @param options The options for executing the command.
 */
export async function exec(
    command: string,
    args: string[],
    options: child_process.SpawnOptionsWithoutStdio = {}
): Promise<void> {
    let logMessage = "> " + command;
    if (args.length > 0) {
        logMessage += " " + args.join(" ");
    }
    console.log(logMessage + "\n");
    return new Promise<void>((resolve, reject) => {
        const childProcess = child_process.spawn(command, args, { stdio: "inherit", ...options });
        childProcess.once("error", reject);
        childProcess.once("close", (code, signal) => {
            if (signal !== null) {
                reject(new Error(`Process exited due to signal '${signal}'`));
            } else if (code !== 0) {
                reject(new Error(`Process exited with code ${code}`));
            } else {
                resolve();
            }
            console.log("");
        });
    });
}
