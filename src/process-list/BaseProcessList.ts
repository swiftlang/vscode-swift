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
import { Process, ProcessList } from ".";
import * as child_process from "child_process";
import * as util from "util";

import { lineBreakRegex } from "../utilities/tasks";

const exec = util.promisify(child_process.execFile);

/** Parses process information from a given line of process output. */
export type ProcessListParser = (line: string) => Process | undefined;

/**
 * Implements common behavior between the different {@link ProcessList} implementations.
 */
export abstract class BaseProcessList implements ProcessList {
    /**
     * Get the command responsible for collecting all processes on the system.
     */
    protected abstract getCommand(): string;

    /**
     * Get the list of arguments used to launch the command.
     */
    protected abstract getCommandArguments(): string[];

    /**
     * Create a new parser that can read the process information from stdout of the process
     * spawned by {@link spawnProcess spawnProcess()}.
     */
    protected abstract createParser(): ProcessListParser;

    async listAllProcesses(): Promise<Process[]> {
        const execCommand = exec(this.getCommand(), this.getCommandArguments(), {
            maxBuffer: 10 * 1024 * 1024, // Increase the max buffer size to 10Mb
        });
        const parser = this.createParser();
        return (await execCommand).stdout.split(lineBreakRegex).flatMap(line => {
            const process = parser(line.toString());
            if (!process || process.id === execCommand.child.pid) {
                return [];
            }
            return [process];
        });
    }
}
