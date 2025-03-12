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
        switch (process.platform) {
            case "darwin":
                expectProcessName(processes, "Code Helper");
                expectProcessName(processes, "Code Helper (GPU)");
                expectProcessName(processes, "Code Helper (Plugin)");
                expectProcessName(processes, "Code Helper (Renderer)");
                break;
            case "win32":
                expectProcessName(processes, "Code.exe");
                break;
            case "linux":
                expectProcessName(processes, "code");
                break;
            default:
                this.skip();
        }
    });
});
