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
import { execFile } from "./utilities";

/**
 * Asks the shell where a binary is located. Will always return at least one path unless
 * resolution fails completely, in which case the function will throw.
 *
 * @param binaryName The name of the binary to search for.
 * @returns An array of paths found on the system.
 */
export async function findBinaryInPath(binaryName: string): Promise<string> {
    try {
        switch (process.platform) {
            case "darwin": {
                const { stdout } = await execFile("which", [binaryName]);
                return stdout.trimEnd();
            }
            case "win32": {
                const command = "where.exe";
                const args = [binaryName];
                const { stdout, stderr } = await execFile(command, args);
                const foundPaths = stdout.trimEnd().split("\r\n");
                if (foundPaths.length === 0) {
                    throw createParsingError({ command, args, stdout, stderr });
                }
                return foundPaths[0];
            }
            default: {
                // use `type` to find the binary on Linux. Run inside /bin/sh to ensure
                // we get consistent output as different shells output a different
                // format. Tried running with `-p` but that is not available in /bin/sh
                const command = "/bin/sh";
                const args = ["-c", `LC_MESSAGES=C type ${binaryName}`];
                const { stdout, stderr } = await execFile(command, args);
                const binaryNameMatch = new RegExp(`^${binaryName} is (.*)$`).exec(
                    stdout.trimEnd()
                );
                if (!binaryNameMatch) {
                    throw createParsingError({ command, args, stdout, stderr });
                }
                return binaryNameMatch[1];
            }
        }
    } catch (error) {
        throw Error(`Failed to find binary "${binaryName}" in PATH`, { cause: error });
    }
}

function createParsingError(options: {
    command: string;
    args: string[];
    stdout: string;
    stderr: string;
}): Error {
    const { command, args, stdout, stderr } = options;
    const quotedArgs = args.map(a => `"${a}"`).join(" ");
    let message = `Failed to parse the output of '${command} ${quotedArgs}'.`;
    if (stdout.trim()) {
        message += `\nstdout: ${stdout.trim()}`;
    }
    if (stderr.trim()) {
        message += `\nstderr: ${stderr.trim()}`;
    }
    return Error(message);
}
