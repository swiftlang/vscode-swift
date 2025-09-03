//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import * as path from "path";
import { fileExists, pathExists } from "@src/utilities/filesystem";

suite("File System Utilities Test Suite", () => {
    test("fileExists", async () => {
        assert(await fileExists(__filename));
        assert(!(await fileExists(__dirname)));
        assert(!(await fileExists(path.join(__filename, "i_dont_exist.txt"))));
    });

    test("pathExists", async () => {
        assert(await pathExists(__filename));
        assert(await pathExists(__dirname));
        assert(!(await pathExists(path.join(__filename, "i_dont_exist.txt"))));
    });
});
