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
import { Version } from "../../../src/utilities/version";

suite("Version Suite", () => {
    suite("fromString", () => {
        test("parses major.minor", () => {
            const version = Version.fromString("5.10");

            assert.equal(version?.major, 5);
            assert.equal(version?.minor, 10);
            assert.equal(version?.patch, 0);
        });

        test("parses major.minor.patch", () => {
            const version = Version.fromString("5.10.1");

            assert.equal(version?.major, 5);
            assert.equal(version?.minor, 10);
            assert.equal(version?.patch, 1);
        });

        test("ignores extra digits", () => {
            const version = Version.fromString("5.10.1.2");

            assert.equal(version?.major, 5);
            assert.equal(version?.minor, 10);
            assert.equal(version?.patch, 1);
        });

        test("ignores extra characters", () => {
            let version = Version.fromString("5.10.1.2 abc");

            assert.equal(version?.major, 5);
            assert.equal(version?.minor, 10);
            assert.equal(version?.patch, 1);

            version = Version.fromString("abc1.2.3");

            assert.equal(version?.major, 1);
            assert.equal(version?.minor, 2);
            assert.equal(version?.patch, 3);
        });

        test("no digits", () => {
            const version = Version.fromString("a.b.c");

            assert.equal(version, undefined);
        });

        test("only one character", () => {
            const version = Version.fromString("1");

            assert.equal(version, undefined);
        });
    });

    test("toString", () => {
        assert.equal(new Version(5, 10, 1).toString(), "5.10.1");
    });

    test("isLessThan", () => {
        assert.equal(new Version(5, 10, 1).isLessThan(new Version(6, 0, 0)), true);
        assert.equal(new Version(5, 9, 0).isLessThan(new Version(5, 10, 0)), true);
        assert.equal(new Version(5, 10, 0).isLessThan(new Version(5, 10, 1)), true);
        assert.equal(new Version(5, 10, 1).isLessThan(new Version(5, 10, 1)), false);
        assert.equal(new Version(5, 10, 0).isLessThan(new Version(5, 9, 0)), false);
        assert.equal(new Version(5, 10, 1).isLessThan(new Version(5, 10, 0)), false);
        assert.equal(new Version(6, 0, 0).isLessThan(new Version(5, 10, 1)), false);
    });

    test("isLessThanOrEqual", () => {
        assert.equal(new Version(5, 10, 1).isLessThanOrEqual(new Version(6, 0, 0)), true);
        assert.equal(new Version(5, 9, 0).isLessThanOrEqual(new Version(5, 10, 0)), true);
        assert.equal(new Version(5, 10, 0).isLessThanOrEqual(new Version(5, 10, 1)), true);
        assert.equal(new Version(5, 10, 1).isLessThanOrEqual(new Version(5, 10, 1)), true);
        assert.equal(new Version(5, 10, 0).isLessThanOrEqual(new Version(5, 9, 0)), false);
        assert.equal(new Version(5, 10, 1).isLessThanOrEqual(new Version(5, 10, 0)), false);
        assert.equal(new Version(6, 0, 0).isLessThanOrEqual(new Version(5, 10, 1)), false);
    });

    test("isGreaterThan", () => {
        assert.equal(new Version(5, 10, 1).isGreaterThan(new Version(6, 0, 0)), false);
        assert.equal(new Version(5, 9, 0).isGreaterThan(new Version(5, 10, 0)), false);
        assert.equal(new Version(5, 10, 0).isGreaterThan(new Version(5, 10, 1)), false);
        assert.equal(new Version(5, 10, 1).isGreaterThan(new Version(5, 10, 1)), false);
        assert.equal(new Version(5, 10, 0).isGreaterThan(new Version(5, 9, 0)), true);
        assert.equal(new Version(5, 10, 1).isGreaterThan(new Version(5, 10, 0)), true);
        assert.equal(new Version(6, 0, 0).isGreaterThan(new Version(5, 10, 1)), true);
    });

    test("isGreaterThanOrEqual", () => {
        assert.equal(new Version(5, 10, 1).isGreaterThanOrEqual(new Version(6, 0, 0)), false);
        assert.equal(new Version(5, 9, 0).isGreaterThanOrEqual(new Version(5, 10, 0)), false);
        assert.equal(new Version(5, 10, 0).isGreaterThanOrEqual(new Version(5, 10, 1)), false);
        assert.equal(new Version(5, 10, 1).isGreaterThanOrEqual(new Version(5, 10, 1)), true);
        assert.equal(new Version(5, 10, 0).isGreaterThanOrEqual(new Version(5, 9, 0)), true);
        assert.equal(new Version(5, 10, 1).isGreaterThanOrEqual(new Version(5, 10, 0)), true);
        assert.equal(new Version(6, 0, 0).isGreaterThanOrEqual(new Version(5, 10, 1)), true);
    });
});
