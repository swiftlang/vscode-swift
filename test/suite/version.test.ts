//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import { Version } from "../../src/utilities/version";

suite("Version Test Suite", () => {
    test("parseVersion", () => {
        const version = Version.fromString("2.3.6");
        assert.strictEqual(version?.major, 2);
        assert.strictEqual(version?.minor, 3);
        assert.strictEqual(version?.patch, 6);
    });
    test("parseTwoDigitVersion", () => {
        const version = Version.fromString("4.1");
        assert.strictEqual(version?.major, 4);
        assert.strictEqual(version?.minor, 1);
        assert.strictEqual(version?.patch, 0);
    });
    test("parseVersionWithString", () => {
        const version = Version.fromString("4.1.1-dev");
        assert.strictEqual(version?.major, 4);
        assert.strictEqual(version?.minor, 1);
        assert.strictEqual(version?.patch, 1);
    });
    test("parseTwoDigitVersionWithString", () => {
        const version = Version.fromString("5.5-dev");
        assert.strictEqual(version?.major, 5);
        assert.strictEqual(version?.minor, 5);
        assert.strictEqual(version?.patch, 0);
    });
    test("lessThan", () => {
        assert(new Version(1, 0, 0).isLessThan(new Version(1, 2, 1)));
        assert(new Version(2, 3, 0).isLessThan(new Version(2, 3, 1)));
        assert(new Version(3, 5, 3).isLessThan(new Version(4, 0, 1)));
    });
    test("lessThanOrEqual", () => {
        assert(new Version(1, 0, 0).isLessThanOrEqual(new Version(1, 2, 1)));
        assert(new Version(2, 3, 0).isLessThanOrEqual(new Version(2, 3, 1)));
        assert(new Version(3, 5, 3).isLessThanOrEqual(new Version(4, 0, 1)));
        assert(new Version(2, 2, 1).isLessThanOrEqual(new Version(2, 2, 1)));
    });
    test("greaterThan", () => {
        assert(new Version(1, 0, 1).isGreaterThan(new Version(1, 0, 0)));
        assert(new Version(2, 3, 0).isGreaterThan(new Version(1, 4, 1)));
        assert(new Version(3, 3, 0).isGreaterThan(new Version(3, 2, 7)));
    });
    test("greaterThanOrEqual", () => {
        assert(new Version(1, 0, 1).isGreaterThanOrEqual(new Version(1, 0, 0)));
        assert(new Version(2, 3, 0).isGreaterThanOrEqual(new Version(1, 4, 1)));
        assert(new Version(3, 3, 0).isGreaterThanOrEqual(new Version(3, 2, 7)));
        assert(new Version(7, 1, 2).isGreaterThanOrEqual(new Version(7, 1, 2)));
    });
});
