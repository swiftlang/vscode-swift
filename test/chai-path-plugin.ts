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
/* eslint-disable @typescript-eslint/no-namespace */
import * as path from "path";

declare global {
    namespace Chai {
        interface Assertion {
            /**
             * Asserts that the object equals the expected path.
             *
             * This assertion will convert both paths to the same file separator and then
             * compare them to ensure consistent behavior on all platforms.
             *
             * @param expected The expected path string.
             */
            path(expected: string): Assertion;
        }
    }
}

export function chaiPathPlugin(chai: Chai.ChaiStatic, _utils: Chai.ChaiUtils): void {
    chai.Assertion.addMethod("path", function (expected: string) {
        const obj = this._obj;
        // First make sure the object is a string.
        new chai.Assertion(obj).to.be.a.string;
        // Then check for path equality.
        const expectedResolved = path.resolve(expected);
        const objResolved = path.resolve(obj);
        this.assert(
            objResolved === expectedResolved,
            `expected path "${objResolved}" to equal "${expectedResolved}"`,
            `expected path "${objResolved}" to not equal "${expectedResolved}"`,
            expectedResolved,
            objResolved
        );
    });
}
