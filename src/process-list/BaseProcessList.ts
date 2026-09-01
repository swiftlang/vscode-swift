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

import { SwiftLogger } from "../logging/SwiftLogger";
import { lineBreakRegex } from "../utilities/tasks";

const exec = util.promisify(child_process.execFile);

/** The label applied to all log messages emitted while listing processes. */
const logLabel = "Process List";

/** How often to report that the process listing command is still running. */
const progressLogIntervalMs = 5000;

/** The maximum number of progress reports to emit, so that a spin can't spam the log forever. */
const maxProgressLogs = 6;

/** Parses process information from a given line of process output. */
export type ProcessListParser = (line: string) => Process | undefined;

/**
 * Implements common behavior between the different {@link ProcessList} implementations.
 */
export abstract class BaseProcessList implements ProcessList {
    /**
     * @param logger An optional logger used to record diagnostics about the process listing
     *   command. Listing processes shells out to a platform specific command that has been seen
     *   spinning indefinitely on Windows, and without these diagnostics such a spin is invisible.
     */
    constructor(private readonly logger?: SwiftLogger) {}

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
        const command = this.getCommand();
        const startTime = Date.now();
        const elapsed = () => Date.now() - startTime;
        // Declared out here so that a failure to even spawn the command is logged as well.
        let progressTimer: NodeJS.Timeout | undefined;
        let pid: number | undefined;
        try {
            const execCommand = exec(command, this.getCommandArguments(), {
                maxBuffer: 10 * 1024 * 1024, // Increase the max buffer size to 10Mb
            });
            pid = execCommand.child.pid;
            this.logger?.debug(`Listing all processes via '${command}' (pid ${pid})`, {
                label: logLabel,
            });

            // If the command hangs then the promise below simply never settles, which leaves us
            // with nothing to go on. Report progress periodically so that a spin can be told apart
            // from a command that is merely slow.
            let progressLogs = 0;
            progressTimer = setInterval(() => {
                this.logger?.warn(
                    `'${command}' (pid ${pid}) is still running after ${elapsed()}ms`,
                    { label: logLabel }
                );
                if (++progressLogs >= maxProgressLogs) {
                    clearInterval(progressTimer);
                }
            }, progressLogIntervalMs);

            const { stdout, stderr } = await execCommand;
            if (stderr.length > 0) {
                this.logger?.warn(`'${command}' (pid ${pid}) wrote to stderr: ${stderr}`, {
                    label: logLabel,
                });
            }

            const parser = this.createParser();
            const processes = stdout.split(lineBreakRegex).flatMap(line => {
                const process = parser(line.toString());
                if (!process || process.id === pid) {
                    return [];
                }
                return [process];
            });
            this.logger?.debug(
                `'${command}' (pid ${pid}) exited after ${elapsed()}ms, parsed ` +
                    `${processes.length} processes from ${stdout.length} bytes of output`,
                { label: logLabel }
            );
            return processes;
        } catch (error) {
            this.logger?.error(`'${command}' (pid ${pid}) failed after ${elapsed()}ms: ${error}`, {
                label: logLabel,
            });
            throw error;
        } finally {
            clearInterval(progressTimer);
        }
    }
}
