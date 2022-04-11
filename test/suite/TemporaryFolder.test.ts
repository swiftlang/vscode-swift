//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import * as fs from "fs/promises";
import { TemporaryFolder } from "../../src/utilities/tempFolder";

suite("Temporary Folder Test Suite", () => {
    test("Create/Delete File", async () => {
        const fileContents = "Test file";
        const tempFolder = await TemporaryFolder.create();
        const fileName = tempFolder.filename("test");
        assert.doesNotThrow(async () => await fs.writeFile(fileName, fileContents));
        assert.doesNotThrow(async () => {
            const contents = await fs.readFile(fileName);
            assert.strictEqual(contents, fileContents);
        });
        assert.doesNotThrow(async () => await fs.rm(fileName));
    });
});
