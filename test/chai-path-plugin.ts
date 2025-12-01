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
import * as path from "path";

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
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
            equalPath(expected: string): Assertion;

            /**
             * Asserts that the object equals the expected path.
             *
             * This assertion will convert both paths to the same file separator and then
             * compare them to ensure consistent behavior on all platforms.
             *
             * @param expected The expected path string.
             */
            equalsPath(expected: string): Assertion;
        }

        interface PromisedAssertion {
            /**
             * Asserts that the object equals the expected path.
             *
             * This assertion will convert both paths to the same file separator and then
             * compare them to ensure consistent behavior on all platforms.
             *
             * @param expected The expected path string.
             */
            equalPath(expected: string): PromisedAssertion;

            /**
             * Asserts that the object equals the expected path.
             *
             * This assertion will convert both paths to the same file separator and then
             * compare them to ensure consistent behavior on all platforms.
             *
             * @param expected The expected path string.
             */
            equalsPath(expected: string): PromisedAssertion;
        }
    }
}

export function chaiPathPlugin(chai: Chai.ChaiStatic, _utils: Chai.ChaiUtils): void {
    function assertPath(this: Chai.AssertionStatic, expected: string): void {
        const obj = this._obj;
        // First make sure the object is a string.
        new chai.Assertion(obj).to.be.a.string;
        // Then check for path equality.
        const expectedNormalized = normalizePath(expected);
        const objNormalized = normalizePath(obj);
        this.assert(
            objNormalized === expectedNormalized,
            `expected path "${objNormalized}" to equal "${expectedNormalized}"`,
            `expected path "${objNormalized}" to not equal "${expectedNormalized}"`,
            expectedNormalized,
            objNormalized
        );
    }

    chai.Assertion.addMethod("equalPath", assertPath);
    chai.Assertion.addMethod("equalsPath", assertPath);
}

function normalizePath(input: string): string {
    return normalizeWindowsDriveLetter(path.resolve(input));
}

function normalizeWindowsDriveLetter(input: string): string {
    if (process.platform !== "win32") {
        return input;
    }
    const root = path.parse(input).root;
    return root.toLocaleUpperCase() + input.slice(root.length);
}
