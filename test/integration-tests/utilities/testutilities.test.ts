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
import { expect } from "chai";

import { isConfigurationSuperset } from "./testutilities";

suite("Test Utilities", () => {
    suite("isConfigurationSuperset", () => {
        test("Primitive type tests", () => {
            expect(isConfigurationSuperset(5, 5)).to.be.true;
            expect(isConfigurationSuperset("test", "test")).to.be.true;
            expect(isConfigurationSuperset(true, true)).to.be.true;
            expect(isConfigurationSuperset(5, 6)).to.be.false;
            expect(isConfigurationSuperset(null, null)).to.be.true;
            expect(isConfigurationSuperset(undefined, undefined)).to.be.true;
        });

        test("Array tests", () => {
            expect(isConfigurationSuperset([1, 2, 3], [1])).to.be.true;
            expect(isConfigurationSuperset([1, 2, 3], [4])).to.be.false;
            expect(isConfigurationSuperset([{ a: 1 }], [{ a: 1 }])).to.be.true;
            expect(isConfigurationSuperset([{ a: 1, b: 2 }], [{ a: 1 }])).to.be.true;
        });

        test("Object tests", () => {
            expect(isConfigurationSuperset({ a: 1, b: 2 }, { a: 1 })).to.be.true;
            expect(isConfigurationSuperset({ a: 1 }, { a: 1, b: 2 })).to.be.false;
            expect(isConfigurationSuperset({ a: { b: 1, c: 2 } }, { a: { b: 1 } })).to.be.true;
            expect(isConfigurationSuperset({ a: { b: 1 } }, { a: { b: 2 } })).to.be.false;
        });

        test("Mixed type tests", () => {
            expect(isConfigurationSuperset({ a: [1, 2, 3] }, { a: [1] })).to.be.true;
            expect(isConfigurationSuperset({ a: 1, b: [1, 2] }, { a: 1, b: [1] })).to.be.true;
            expect(isConfigurationSuperset({ a: 1, b: [1, 2] }, { a: 1, b: [3] })).to.be.false;
        });

        test("Edge cases", () => {
            expect(isConfigurationSuperset({}, {})).to.be.true;
            expect(isConfigurationSuperset([], [])).to.be.true;
            expect(isConfigurationSuperset({ a: undefined }, { a: undefined })).to.be.true;
            expect(isConfigurationSuperset({ a: null }, { a: null })).to.be.true;
            expect(isConfigurationSuperset({ a: null }, { a: undefined })).to.be.false;
        });
    });
});
