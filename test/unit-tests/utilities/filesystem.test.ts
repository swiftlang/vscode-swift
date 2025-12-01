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
import { expect } from "chai";
import { Uri } from "vscode";

import {
    expandFilePathTilde,
    isExcluded,
    isIncluded,
    isPathInsidePath,
} from "@src/utilities/filesystem";

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

    suite("expandFilePathTilde", () => {
        test("expands tilde", () => {
            expect(expandFilePathTilde("~/Test", "/Users/John", "darwin")).to.equalPath(
                "/Users/John/Test"
            );
        });

        test("no tilde present", () => {
            expect(expandFilePathTilde("/Users/John/Test", "/Users/John2", "darwin")).to.equal(
                "/Users/John/Test"
            );
        });

        test("tilde not first character", () => {
            expect(expandFilePathTilde("/Users/~/Test", "/Users/John", "darwin")).to.equal(
                "/Users/~/Test"
            );
        });

        test("don't know the home directory", () => {
            expect(expandFilePathTilde("~/Test", null, "darwin")).to.equal("~/Test");
        });

        test("don't resolve tilde on Windows", () => {
            expect(expandFilePathTilde("~/Test", "C:\\Users\\John", "win32")).to.equal("~/Test");
        });
    });

    suite("isExcluded()", () => {
        const uri = Uri.file("path/to/foo/bar/file.swift");

        test("excluded", () => {
            expect(isExcluded(uri, { "/path": true })).to.be.true;
            expect(isExcluded(uri, { "**/foo": true })).to.be.true;
            expect(isExcluded(uri, { "**/foo/**": true })).to.be.true;
        });

        test("excluded, overwriting patterns", () => {
            expect(isExcluded(uri, { "**/foo": false, "**/foo/bar": true })).to.be.true;
        });

        test("NOT excluded", () => {
            expect(isExcluded(uri, { "**/qux/**": false })).to.be.false;
            expect(isExcluded(uri, { "**/foo": false, "**/foo/qux": true })).to.be.false;
            expect(
                isExcluded(uri, {
                    "**/foo": false,
                    "**/foo/bar": true,
                    "**/foo/bar/file.swift": false,
                })
            ).to.be.false;
        });
    });

    suite("isIncluded()", () => {
        const uri = Uri.file("path/to/foo/bar/file.swift");

        test("included", () => {
            expect(isIncluded(uri, {})).to.be.true;
            expect(isIncluded(uri, { "/path": false })).to.be.true;
            expect(isIncluded(uri, { "**/foo": false })).to.be.true;
            expect(isIncluded(uri, { "**/foo/**": false })).to.be.true;
            expect(isIncluded(uri, { "**/qux/**": true })).to.be.true;
        });

        test("included, overwriting patterns", () => {
            expect(isIncluded(uri, { "**/foo": true, "**/foo/bar": false })).to.be.true;
        });

        test("NOT included", () => {
            expect(isIncluded(uri, { "**/foo": true })).to.be.false;
            expect(isIncluded(uri, { "**/foo": true, "**/foo/qux": false })).to.be.false;
            expect(
                isIncluded(uri, {
                    "**/foo": true,
                    "**/foo/bar": false,
                    "**/foo/bar/file.swift": true,
                })
            ).to.be.false;
        });
    });
});
