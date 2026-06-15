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
import type * as winston from "winston";

import { RollingLog } from "./RollingLog";

import TransportStream = require("winston-transport");

export class RollingLogTransport extends TransportStream {
    constructor(private rollingLog: RollingLog) {
        super({ level: "debug" });
    }

    public log(info: winston.Logform.TransformableInfo, next: () => void): void {
        this.rollingLog.appendLine(String(info[Symbol.for("message")]));
        next();
    }
}
