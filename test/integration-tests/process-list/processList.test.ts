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

import * as path from "path";
import { expect } from "chai";
import { createProcessList, Process } from "../../../src/process-list";

suite("ProcessList Tests", () => {
    function expectProcessName(processes: Process[], command: string) {
        expect(
            processes.findIndex(proc => path.basename(proc.command) === command),
            `Expected the list of processes to include '${command}':\n ${processes.map(proc => `${proc.id} - ${path.basename(proc.command)}`).join("\n")}\n\n`
        ).to.be.greaterThanOrEqual(0);
    }

    test("retreives the list of available processes", async function () {
        // We can guarantee that certain VS Code processes will be present during tests
        const processes = await createProcessList().listAllProcesses();
        let processNameDarwin: string = "Code";
        let processNameWin32: string = "Code";
        let processNameLinux: string = "code";
        if (process.env["VSCODE_VERSION"] === "insiders") {
            processNameDarwin = "Code - Insiders";
            processNameWin32 = "Code - Insiders";
            processNameLinux = "code-insiders";
        }
        switch (process.platform) {
            case "darwin":
                expectProcessName(processes, `${processNameDarwin} Helper`);
                expectProcessName(processes, `${processNameDarwin} Helper (GPU)`);
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
