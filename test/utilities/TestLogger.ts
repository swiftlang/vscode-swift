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
import { RollingLog } from "@src/logging/RollingLog";
import { RollingLogTransport } from "@src/logging/RollingLogTransport";
import { SwiftLogger } from "@src/logging/SwiftLogger";

export class TestLogger extends SwiftLogger {
    private rollingLog: RollingLog;

    get logs(): string[] {
        return this.rollingLog.logs.slice();
    }

    constructor(maxLogs: number = 100) {
        super();
        this.rollingLog = new RollingLog(maxLogs);
        this.addTransport(new RollingLogTransport(this.rollingLog));
    }

    clear(): void {
        this.rollingLog.clear();
    }
}
