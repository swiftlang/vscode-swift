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
/* eslint-disable vscode-swift/no-exclusive-tests */
import type { AsyncFunc, Func, Suite, Test } from "mocha";

/** The set of all available test sizes that can be applied to a test or suite. */
export type TestSize = "unit" | "small" | "medium" | "large";

export interface MochaFunctions {
    suite: Mocha.SuiteFunction;
    test: Mocha.TestFunction;
}

interface TaggedSuite extends Suite {
    __VSCode_Swift_size?: TestSize;
}

interface TaggedTest extends Test {
    __VSCode_Swift_size?: TestSize;
}

/**
 * The size applied to tests and suites that haven't been tagged. Unit tests default to `unit`
 * whereas integration tests default to `small`.
 *
 * The 'VSCODE_SWIFT_DEFAULT_TEST_SIZE' environment variable gets set by '.vscode-test.js'.
 */
function getDefaultTestSize(): TestSize {
    const size = process.env["VSCODE_SWIFT_DEFAULT_TEST_SIZE"];
    switch (size) {
        case "unit":
        case "small":
        case "medium":
        case "large":
            return size;
        default:
            return "small";
    }
}

function getTimeout(size: TestSize): number {
    // Don't time out when debugging.
    // The 'VSCODE_DEBUG' environment variable gets set by '.vscode-test.js'.
    const isDebugRun = process.env["VSCODE_DEBUG"] === "1";
    if (isDebugRun) {
        return 0;
    }

    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    switch (size) {
        case "unit":
            // Keep this up to date with 'unitTestTimeout' in 'vscode-test.js'.
            return 2 * SECOND;
        case "small":
            // Keep this up to date with 'integrationTestTimeout' in 'vscode-test.js'.
            return 30 * SECOND;
        case "medium":
            return 2 * MINUTE;
        case "large":
            return 10 * MINUTE;
    }
}

/**
 * Installs functionality into Mocha that is required to enable support for the tag() function.
 */
export function installTagSupport() {
    const isFastTestRun = process.env["FAST_TEST_RUN"] === "1";

    setup(function () {
        const currentTest: TaggedTest | undefined = this.currentTest;
        if (!currentTest) {
            return;
        }

        // Retrieve tags either from the current test or one of its parent suites.
        // Untagged tests/suites fall back to the default size for the test run.
        let testSize: TestSize = getDefaultTestSize();
        if (currentTest.__VSCode_Swift_size) {
            testSize = currentTest.__VSCode_Swift_size;
        } else {
            let parent: TaggedSuite | undefined = currentTest.parent;
            while (parent) {
                if (parent.__VSCode_Swift_size) {
                    testSize = parent.__VSCode_Swift_size;
                    break;
                }
                parent = parent.parent;
            }
        }

        // Skip large tests during a fast test run.
        if (testSize === "large" && isFastTestRun) {
            currentTest.skip();
        }
    });
}

/**
 * Creates a wrapper around Mocha's suite() and test() functions with the provided tags. At the
 * moment we only support a single test size tag, but more could be added in the future.
 *
 * Tags are used to identify how long a test is expected to run. There are four categories:
 * - **unit:** 2 second timeout used for unit tests, which should never touch slow APIs. This is
 *   the default for everything under `test/unit-tests`.
 * - **small:** 30 second timeout used for the majority of integration tests. This is the default
 *   for everything under `test/integration-tests`.
 * - **medium:** 2 minute timeout used for integration tests that invoke SwiftPM, build a package,
 *   or otherwise wait on a long running external process.
 * - **large:** 10 minute timeout used for very long running tests that should only be run
 *   in the nightly CI.
 *
 * When applied to a suite, all child tests and suites will inherit the tag(s) unless they
 * are tagged otherwise. For example:
 *
 * ```typescript
 * tag("medium").suite("A suite that contains medium sized tests by default", () => {
 *     tag("large").test("Explicitly applies the large tag to the test", () => {
 *         // 10 minute timeout
 *     });
 *
 *     test("Inherits the default tag of medium from the suite", () => {
 *         // 2 minute timeout
 *     });
 *
 *     suite("All tests in this suite will also inherit the medium tag", () => {
 *         // 2 minute timeout
 *     });
 * });
 * ```
 *
 * @param size The size that will be tagged onto the suite or test.
 * @returns A wrapper that can be used to create Mocha tests and suites.
 */
export function tag(size: TestSize): MochaFunctions {
    function applyTags<T extends TaggedSuite | TaggedTest | void>(obj: T): T {
        if (!obj) {
            return obj;
        }

        obj.__VSCode_Swift_size = size;
        obj.timeout(getTimeout(size));

        return obj;
    }

    // Create a mocha suite() function that applies the provided tag(s) to the suite.
    //
    // The timeouts need to be set within the suite function or they won't propagate to
    // to contained suites and tests: https://github.com/mochajs/mocha/issues/5422
    const wrappedSuite = (title: string, fn?: (this: Suite) => void): Suite => {
        if (fn) {
            return suite(title, function () {
                applyTags(this);
                fn.call(this);
            });
        }
        return suite(title);
    };
    wrappedSuite.only = (title: string, fn?: (this: Suite) => void): Suite => {
        if (fn) {
            return suite.only(title, function () {
                applyTags(this);
                fn.call(this);
            });
        }
        return suite.only(title);
    };
    wrappedSuite.skip = (title: string, fn: (this: Suite) => void): Suite | void => {
        return suite.skip(title, function () {
            applyTags(this);
            fn.call(this);
        });
    };

    // Create a mocha test() function that applies the provided tag(s) to the test.
    const wrappedTest = (titleOrFn: string | AsyncFunc | Func, fn?: AsyncFunc | Func): Test => {
        return applyTags(typeof titleOrFn === "string" ? test(titleOrFn, fn) : test(titleOrFn));
    };
    wrappedTest.only = (titleOrFn: string | AsyncFunc | Func, fn?: AsyncFunc | Func): Test => {
        return applyTags(
            typeof titleOrFn === "string" ? test.only(titleOrFn, fn) : test.only(titleOrFn)
        );
    };
    wrappedTest.skip = (titleOrFn: string | AsyncFunc | Func, fn?: AsyncFunc | Func): Test => {
        return applyTags(
            typeof titleOrFn === "string" ? test.skip(titleOrFn, fn) : test.skip(titleOrFn)
        );
    };
    wrappedTest.retries = (n: number): void => {
        return test.retries(n);
    };

    return {
        suite: wrappedSuite,
        test: wrappedTest,
    };
}
