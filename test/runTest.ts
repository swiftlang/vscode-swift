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

import * as cp from "child_process";
import * as path from "path";
import {
    runTests,
    downloadAndUnzipVSCode,
    resolveCliPathFromVSCodeExecutablePath,
    ProgressReport,
    ProgressReporter,
    makeConsoleReporter,
} from "@vscode/test-electron";

/** ProgressReporter that doesn't show  downloading stage */
class CIReporter implements ProgressReporter {
    constructor(
        public showProgress: boolean,
        public progressReporter: ProgressReporter
    ) {}
    report(report: ProgressReport): void {
        if (report.stage === "downloading" && !this.showProgress) {
            // suppress
        } else {
            this.progressReporter.report(report);
        }
    }
    error(err: unknown): void {
        this.progressReporter.error(err);
    }
}

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        const consoleReporter = await makeConsoleReporter();
        const vscodeExecutablePath = await downloadAndUnzipVSCode({
            reporter: new CIReporter(process.env["CI"] !== "1", consoleReporter),
        });
        const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);

        // Use cp.spawn / cp.exec for custom setup
        console.log(`${cliPath} --install-extension vadimcn.vscode-lldb`);
        const { stdout, stderr } = cp.spawnSync(
            cliPath,
            ["--install-extension", "vadimcn.vscode-lldb"],
            {
                encoding: "utf-8",
                stdio: "inherit",
            }
        );
        console.log(stdout);
        console.log(stderr);

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                // Already start in the fixtures dir because we lose debugger connection
                // once we re-open a different folder due to window reloading
                path.join(extensionDevelopmentPath, "assets/test"),
            ],
            reuseMachineInstall: true,
        });
    } catch (err) {
        console.error("Failed to run tests:", err);
        process.exit(1);
    }
}

main();
