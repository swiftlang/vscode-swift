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
import { EOL } from "os";
import type * as winston from "winston";

import { FileWriteStream } from "./FileWriteStream";

import TransportStream = require("winston-transport");

export class FileTransport extends TransportStream {
    private fileWriteStream: FileWriteStream;

    constructor(filePath: Promise<string>, opts?: TransportStream.TransportStreamOptions) {
        super(opts);
        this.fileWriteStream = new FileWriteStream(filePath);
    }

    public log(info: winston.Logform.TransformableInfo, next: () => void): void {
        void this.fileWriteStream.write(info[Symbol.for("message")] + EOL);
        next();
    }

    public close(): void {
        this.fileWriteStream.dispose();
    }
}
