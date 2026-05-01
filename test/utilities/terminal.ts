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
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";

import stripAnsi = require("strip-ansi");

/**
 * Takes the output from a terminal process and returns the final state of the terminal
 * buffer as seen by the end user.
 *
 * @param output The output from the terminal process.
 * @returns A string that contains the final state of the terminal buffer at process exit.
 */
export function fixProcessOutput(output: string): Promise<string> {
    const terminal = new Terminal({ allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);
    return new Promise<string>((resolve, reject) => {
        try {
            terminal.write(output, () => {
                try {
                    resolve(stripAnsi(serializeAddon.serialize()));
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            reject(error);
        }
    }).finally(() => {
        terminal.dispose();
        serializeAddon.dispose();
    });
}
