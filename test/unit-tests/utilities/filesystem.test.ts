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

import { isPathInsidePath, expandFilePathTilda } from "../../../src/utilities/filesystem";
import { expect } from "chai";

suite("File System Utilities Unit Test Suite", () => {
    test("isPathInsidePath", () => {
        expect(isPathInsidePath("/home/user/package", "/home/user/")).to.be.true;
        expect(isPathInsidePath("/home/user/package/test", "/home/user/")).to.be.true;
        expect(isPathInsidePath("/home/user/", "/home/user/")).to.be.true;
        expect(isPathInsidePath("/home/user/.build", "/home/user/")).to.be.true;
        expect(isPathInsidePath("/home/user/package", "/home/user/package2")).to.be.false;
        expect(isPathInsidePath("/home/user/package/.build", "/home/user/package2/.build")).to.be
            .false;
        expect(isPathInsidePath("/home/user/package/", "/home/user/package/.build")).to.be.false;
    });

    suite("expandFilePathTilda", () => {
        test("expands tilda", () => {
            expect(expandFilePathTilda("~/Test", "/Users/John", "darwin")).to.equal(
                "/Users/John/Test"
            );
        });

        test("no tilda present", () => {
            expect(expandFilePathTilda("/Users/John/Test", "/Users/John2", "darwin")).to.equal(
                "/Users/John/Test"
            );
        });

        test("tilda not first character", () => {
            expect(expandFilePathTilda("/Users/~/Test", "/Users/John", "darwin")).to.equal(
                "/Users/~/Test"
            );
        });

        test("don't know the home directory", () => {
            expect(expandFilePathTilda("~/Test", null, "darwin")).to.equal("~/Test");
        });

        test("don't resolve tilda on Windows", () => {
            expect(expandFilePathTilda("~/Test", "C:\\Users\\John", "win32")).to.equal("~/Test");
        });
    });
});
