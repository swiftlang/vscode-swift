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
import { expect } from "chai";

import { SwiftPackage } from "@src/SwiftPackage";

suite("SwiftPackage Suite", () => {
    suite("trimStdout", () => {
        test("strips inline prefix before opening brace on the same line", () => {
            const json = '{\n  "name": "MyPackage"\n}';
            const output = `Another instance of SwiftPM is already running...${json}`;
            expect(SwiftPackage.trimStdout(output)).to.equal(json);
        });

        test("returns empty string when output contains no JSON", () => {
            const output = "Another process is using this build folder";
            expect(SwiftPackage.trimStdout(output)).to.equal("");
        });
    });
});
