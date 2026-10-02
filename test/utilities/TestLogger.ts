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
import type * as winston from "winston";

import { RollingLog } from "@src/logging/RollingLog";
import { RollingLogTransport } from "@src/logging/RollingLogTransport";
import { SwiftLogger } from "@src/logging/SwiftLogger";

export class TestLogger extends SwiftLogger {
    private rollingLog: RollingLog;
    // Trace messages help diagnose test failures in GitHub Actions, so only capture them in CI
    private captureLevel: string;

    get logs(): string[] {
        return this.rollingLog.logs.slice();
    }

    constructor(maxLogs: number = 100) {
        super();
        this.captureLevel = process.env.CI === "1" ? "trace" : "debug";
        this.rollingLog = new RollingLog(maxLogs);
        this.addTransport(new RollingLogTransport(this.rollingLog, this.captureLevel));
    }

    createTransport(level: string = this.captureLevel): winston.transport {
        return super.createTransport(level);
    }

    clear(): void {
        this.rollingLog.clear();
    }
}
