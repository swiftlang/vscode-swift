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
import { expect } from "chai";
import * as child_process from "child_process";
import * as path from "path";
import * as util from "util";

import { SwiftLogger } from "@src/logging/SwiftLogger";
import { Process, createProcessList } from "@src/process-list";

import { attachCapturedLogs } from "../../reporters/utilities";
import { TestLogger } from "../../utilities/TestLogger";

const exec = util.promisify(child_process.execFile);

/** How long to wait before assuming that listing processes is spinning and capturing diagnostics. */
const spinSnapshotTimeoutMs = 5000;

/** The process table snapshot can be enormous, so only keep enough of it to be useful. */
const maxSnapshotLength = 32 * 1024;

/**
 * Captures a snapshot of the process table.
 *
 * This deliberately avoids PowerShell and WMI/CIM on Windows, since the leading theory for the
 * spins that this exists to diagnose is that the WMI query itself is what wedges. `tasklist`
 * reports whether a process is responding, which is the interesting part.
 */
async function logProcessTableSnapshot(logger: SwiftLogger, reason: string): Promise<void> {
    const { command, args } =
        process.platform === "win32"
            ? { command: "tasklist", args: ["/v", "/fo", "csv"] }
            : { command: "ps", args: ["axo", "pid,ppid,stat,etime,command"] };
    try {
        const { stdout } = await exec(command, args, { maxBuffer: 10 * 1024 * 1024 });
        const snapshot =
            stdout.length > maxSnapshotLength
                ? `${stdout.slice(0, maxSnapshotLength)}\n...(truncated ${stdout.length - maxSnapshotLength} bytes)`
                : stdout;
        logger.warn(`${reason}. Process table snapshot from '${command}':\n${snapshot}`);
    } catch (error) {
        logger.error(`${reason}. Failed to snapshot the process table via '${command}': ${error}`);
    }
}

/**
 * Runs `work`, capturing a snapshot of the process table if it hasn't completed in time.
 *
 * The work is still awaited afterwards so that a genuinely slow machine doesn't fail the test, but
 * if it never completes then the snapshot has already been logged by the time Mocha times us out.
 */
async function withHangDiagnostics<T>(logger: SwiftLogger, work: () => Promise<T>): Promise<T> {
    const timer = setTimeout(() => {
        void logProcessTableSnapshot(
            logger,
            `Listing processes has not completed after ${spinSnapshotTimeoutMs}ms`
        );
    }, spinSnapshotTimeoutMs);
    try {
        return await work();
    } finally {
        clearTimeout(timer);
    }
}

suite("ProcessList Tests", () => {
    let logger: TestLogger;

    setup(() => {
        logger = new TestLogger();
    });

    teardown(function () {
        // This suite doesn't activate the extension, so nothing else attaches logs on our behalf.
        // Attach them here so that the reporter prints them for any failure, including a timeout.
        if (this.currentTest) {
            attachCapturedLogs(this.currentTest, logger.logs);
        }
        logger.dispose();
    });

    function expectProcessName(processes: Process[], command: string) {
        const processList = processes
            .map(proc => `${proc.id} - ${path.basename(proc.command)}`)
            .join("\n");
        expect(
            processes.findIndex(proc => path.basename(proc.command) === command),
            `Expected the list of processes to include '${command}':\n ${processList}\n\n`
        ).to.be.greaterThanOrEqual(0);
    }

    test("retreives the list of available processes", async function () {
        // We can guarantee that certain VS Code processes will be present during tests
        const processes = await withHangDiagnostics(logger, () =>
            createProcessList(logger).listAllProcesses()
        );
        let processNameDarwin: string = "Code";
        let processNameWin32: string = "Code";
        let processNameLinux: string = "code";
        if (process.env["VSCODE_VERSION"] === "insiders") {
            processNameDarwin = "Code - Insiders";
            processNameWin32 = "Code - Insiders";
            processNameLinux = "code-insiders";
        }
        if (process.env["REMOTE_CONTAINERS"] === "true") {
            processNameDarwin = "node";
            processNameWin32 = "node";
            processNameLinux = "node";
        }
        switch (process.platform) {
            case "darwin":
                expectProcessName(processes, `${processNameDarwin} Helper`);
                expectProcessName(processes, `${processNameDarwin} Helper (Plugin)`);
                expectProcessName(processes, `${processNameDarwin} Helper (Renderer)`);
                break;
            case "win32":
                expectProcessName(processes, `${processNameWin32}.exe`);
                break;
            case "linux":
                expectProcessName(processes, `${processNameLinux}`);
                break;
            default:
                this.skip();
        }
    });
});
