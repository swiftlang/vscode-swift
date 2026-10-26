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
import { expect } from "chai";

import { FolderContext } from "@src/FolderContext";
import { describePackage } from "@src/commands/dependencies/describe";
import { RollingLog } from "@src/logging/RollingLog";
import { RollingLogTransport } from "@src/logging/RollingLogTransport";

import { tag } from "../../tags";
import { activateExtensionForSuite, findWorkspaceFolder } from "../utilities/testutilities";

tag("medium").suite("Describe Package Test Suite", function () {
    const rollingLog = new RollingLog(1000);
    let folderContext: FolderContext;

    activateExtensionForSuite({
        async setup(api) {
            const workspaceContext = await api.waitForWorkspaceContext();
            workspaceContext.logger.addTransport(new RollingLogTransport(rollingLog, "trace"));
            folderContext = findWorkspaceFolder("defaultPackage", workspaceContext)!;
        },
    });

    test("Traces the swift process", async () => {
        rollingLog.clear();

        await describePackage(folderContext);

        const processLines = rollingLog.logs.filter(line => line.includes("SwiftProcess:"));
        expect(processLines.some(line => line.includes("describe"))).to.be.true;
    });
});
