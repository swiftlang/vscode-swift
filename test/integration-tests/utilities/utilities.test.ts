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

import * as assert from "assert";
import * as Stream from "stream";
import { execFileStreamOutput, execSwift, getSwiftExecutable } from "@src/utilities/utilities";

suite("Utilities Test Suite", () => {
    test("execFileStreamOutput", async () => {
        const swift = getSwiftExecutable();
        let result = "";
        // Use WriteStream to log results
        const writeStream = new Stream.Writable();
        writeStream._write = (chunk, _encoding, next) => {
            const text = chunk.toString("utf8");
            result += text;
            next();
        };
        writeStream.on("close", () => {
            writeStream.end();
        });

        const { stdout } = await execSwift(["--version"], "default");
        await execFileStreamOutput(swift, ["--version"], writeStream, null, null);
        assert(result.length > 0);
        assert(result.includes("Swift version"));
        assert.strictEqual(result, stdout);
    });
});
