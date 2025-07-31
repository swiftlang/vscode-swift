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
import * as TransportType from "winston-transport";
import { RollingLog } from "./RollingLog";

// Compile error if don't use "require": https://github.com/swiftlang/vscode-swift/actions/runs/16529946578/job/46752753379?pr=1746
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Transport: typeof TransportType = require("winston-transport");

export class RollingLogTransport extends Transport {
    constructor(private rollingLog: RollingLog) {
        super();
        this.level = "info"; // This log is used for testing, we don't want to hold verbose log messages
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public log(info: any, next: () => void): void {
        if (info.append) {
            this.rollingLog.append(info.message);
        } else {
            this.rollingLog.appendLine(info.message);
        }
        next();
    }
}
