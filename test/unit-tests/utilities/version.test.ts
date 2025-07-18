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
import { Version } from "../../../src/utilities/version";

suite("Version Suite", () => {
    suite("fromString", () => {
        test("parses major.minor", () => {
            const version = Version.fromString("5.10");

            expect(version?.major).to.equal(5);
            expect(version?.minor).to.equal(10);
            expect(version?.patch).to.equal(0);
            expect(version?.dev).to.be.false;
        });

        test("parses major.minor.patch", () => {
            const version = Version.fromString("5.10.1");

            expect(version?.major).to.equal(5);
            expect(version?.minor).to.equal(10);
            expect(version?.patch).to.equal(1);
            expect(version?.dev).to.be.false;
        });

        test("parses -dev suffix", () => {
            const version = Version.fromString("5.10.1-dev");

            expect(version?.major).to.equal(5);
            expect(version?.minor).to.equal(10);
            expect(version?.patch).to.equal(1);
            expect(version?.dev).to.be.true;
        });

        test("ignores extra digits", () => {
            const version = Version.fromString("5.10.1.2");

            expect(version?.major).to.equal(5);
            expect(version?.minor).to.equal(10);
            expect(version?.patch).to.equal(1);
        });

        test("ignores extra characters", () => {
            let version = Version.fromString("5.10.1.2 abc");

            expect(version?.major).to.equal(5);
            expect(version?.minor).to.equal(10);
            expect(version?.patch).to.equal(1);

            version = Version.fromString("abc1.2.3");

            expect(version?.major).to.equal(1);
            expect(version?.minor).to.equal(2);
            expect(version?.patch).to.equal(3);
        });

        test("no digits", () => {
            const version = Version.fromString("a.b.c");

            expect(version).to.equal(undefined);
        });

        test("only one character", () => {
            const version = Version.fromString("1");

            expect(version).to.equal(undefined);
        });
    });

    test("toString", () => {
        expect(new Version(5, 10, 1).toString(), "5.10.1");
    });

    test("isLessThan", () => {
        expect(new Version(5, 10, 1).isLessThan(new Version(6, 0, 0))).to.be.true;
        expect(new Version(5, 9, 0).isLessThan(new Version(5, 10, 0))).to.be.true;
        expect(new Version(5, 10, 0).isLessThan(new Version(5, 10, 1))).to.be.true;
        expect(new Version(5, 10, 1).isLessThan(new Version(5, 10, 1))).to.be.false;
        expect(new Version(5, 10, 0).isLessThan(new Version(5, 9, 0))).to.be.false;
        expect(new Version(5, 10, 1).isLessThan(new Version(5, 10, 0))).to.be.false;
        expect(new Version(6, 0, 0).isLessThan(new Version(5, 10, 1))).to.be.false;
    });

    test("isLessThanOrEqual", () => {
        expect(new Version(5, 10, 1).isLessThanOrEqual(new Version(6, 0, 0))).to.be.true;
        expect(new Version(5, 9, 0).isLessThanOrEqual(new Version(5, 10, 0))).to.be.true;
        expect(new Version(5, 10, 0).isLessThanOrEqual(new Version(5, 10, 1))).to.be.true;
        expect(new Version(5, 10, 1).isLessThanOrEqual(new Version(5, 10, 1))).to.be.true;
        expect(new Version(5, 10, 0).isLessThanOrEqual(new Version(5, 9, 0))).to.be.false;
        expect(new Version(5, 10, 1).isLessThanOrEqual(new Version(5, 10, 0))).to.be.false;
        expect(new Version(6, 0, 0).isLessThanOrEqual(new Version(5, 10, 1))).to.be.false;
    });

    test("isGreaterThan", () => {
        expect(new Version(5, 10, 1).isGreaterThan(new Version(6, 0, 0))).to.be.false;
        expect(new Version(5, 9, 0).isGreaterThan(new Version(5, 10, 0))).to.be.false;
        expect(new Version(5, 10, 0).isGreaterThan(new Version(5, 10, 1))).to.be.false;
        expect(new Version(5, 10, 1).isGreaterThan(new Version(5, 10, 1))).to.be.false;
        expect(new Version(5, 10, 0).isGreaterThan(new Version(5, 9, 0))).to.be.true;
        expect(new Version(5, 10, 1).isGreaterThan(new Version(5, 10, 0))).to.be.true;
        expect(new Version(6, 0, 0).isGreaterThan(new Version(5, 10, 1))).to.be.true;
    });

    test("isGreaterThanOrEqual", () => {
        expect(new Version(5, 10, 1).isGreaterThanOrEqual(new Version(6, 0, 0))).to.be.false;
        expect(new Version(5, 9, 0).isGreaterThanOrEqual(new Version(5, 10, 0))).to.be.false;
        expect(new Version(5, 10, 0).isGreaterThanOrEqual(new Version(5, 10, 1))).to.be.false;
        expect(new Version(5, 10, 1).isGreaterThanOrEqual(new Version(5, 10, 1))).to.be.true;
        expect(new Version(5, 10, 0).isGreaterThanOrEqual(new Version(5, 9, 0))).to.be.true;
        expect(new Version(5, 10, 1).isGreaterThanOrEqual(new Version(5, 10, 0))).to.be.true;
        expect(new Version(6, 0, 0).isGreaterThanOrEqual(new Version(5, 10, 1))).to.be.true;
    });
});
