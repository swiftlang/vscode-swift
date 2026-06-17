//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Chai {
        interface Assertion {
            /**
             * Asserts that an array of strings contains at least one member
             * that matches the given regular expression.
             *
             * @param pattern The regular expression to match against.
             */
            includeMatch(pattern: RegExp): Assertion;

            /**
             * Asserts that an array of strings contains at least one member
             * that matches the given regular expression.
             *
             * @param pattern The regular expression to match against.
             */
            includesMatch(pattern: RegExp): Assertion;
        }

        interface PromisedAssertion {
            /**
             * Asserts that an array of strings contains at least one member
             * that matches the given regular expression.
             *
             * @param pattern The regular expression to match against.
             */
            includeMatch(pattern: RegExp): PromisedAssertion;

            /**
             * Asserts that an array of strings contains at least one member
             * that matches the given regular expression.
             *
             * @param pattern The regular expression to match against.
             */
            includesMatch(pattern: RegExp): PromisedAssertion;
        }
    }
}

export function chaiRegexPlugin(chai: Chai.ChaiStatic, _utils: Chai.ChaiUtils): void {
    function assertIncludesMatch(this: Chai.AssertionStatic, pattern: RegExp) {
        const obj: string[] = this._obj;
        new chai.Assertion(obj).to.be.an("array");
        this.assert(
            obj.some(item => pattern.test(item)),
            `expected array to include a member matching ${pattern}`,
            `expected array to not include a member matching ${pattern}`,
            pattern,
            obj
        );
    }
    chai.Assertion.addMethod("includeMatch", assertIncludesMatch);
    chai.Assertion.addMethod("includesMatch", assertIncludesMatch);
}
