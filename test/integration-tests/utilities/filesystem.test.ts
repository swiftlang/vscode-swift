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
import {
    isPathInsidePath,
    expandFilePathTilda,
    fileExists,
    pathExists,
} from "../../../src/utilities/filesystem";

suite("File System Utilities Test Suite", () => {
    test("isPathInsidePath", () => {
        assert(isPathInsidePath("/home/user/package", "/home/user/"));
        assert(isPathInsidePath("/home/user/package/test", "/home/user/"));
        assert(isPathInsidePath("/home/user/", "/home/user/"));
        assert(isPathInsidePath("/home/user/.build", "/home/user/"));
        assert(!isPathInsidePath("/home/user/package", "/home/user/package2"));
        assert(!isPathInsidePath("/home/user/package/.build", "/home/user/package2/.build"));
        assert(!isPathInsidePath("/home/user/package/", "/home/user/package/.build"));
    });

    test("expandFilePathTilda", () => {
        const homeDir = process.env.HOME;
        assert(expandFilePathTilda("~/Test"), `${homeDir}/Test`);
        assert(expandFilePathTilda("/Users/John/Test"), `/Users/John/Test`);
        assert(expandFilePathTilda("/Users/~/Test"), `/Users/~/Test`);
    });

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
