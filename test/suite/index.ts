//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as path from "path";
import * as Mocha from "mocha";
import * as glob from "glob";

export function run(): Promise<void> {
    process.traceDeprecation = true;

    const options: Mocha.MochaOptions = {
        ui: "tdd",
        color: true,
        timeout: 3000,
        forbidOnly: process.env["CI"] === "1",
    };

    if (process.env.FAST_TEST_RUN) {
        // Run all tests that are not marked with @slow
        options.grep = "@slow";
        options.invert = true;
    }

    // Create the mocha test
    const mocha = new Mocha(options);

    const testsRoot = path.resolve(__dirname, "..");

    return new Promise((c, e) => {
        glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
            if (err) {
                return e(err);
            }

            // Add files to the test suite
            files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // Run the mocha test
                mocha.run(failures => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                console.error(err);
                e(err);
            }
        });
    });
}
